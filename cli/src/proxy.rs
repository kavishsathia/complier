// `complier proxy`: the one MCP server an agent's harness talks to. Bound to a machine and role
// by COMPLIER_MACHINE and COMPLIER_ROLE, it offers only the tools the machine's units name:
// - a translated tool's calls are classified by the unit's CEL rules into an event (a rule's, or
//   the fallback's), which the machine checks as this role's action; the call goes upstream only
//   if it's accepted (fail closed). A call no event can be given (outside the domain, bad
//   arguments, a rule erroring, ambiguous) is refused. A unit's rules are proven when the proxy
//   binds; if they aren't, or the CEL backend can't run, the proxy offers no tools at all;
// - a hidden tool (one its service reviewed as read-only) goes upstream unchecked;
// - every other tool is left out, and so is any tool whose live schema no longer matches the
//   hash `complier gen` recorded for it in the service's metadata.
// Units are YAML (unit.rs): loading one runs nothing, and a unit that doesn't load or isn't
// proven leaves the proxy with no tools before it connects to anything upstream.
// Upstream sessions and credentials stay in this process; the agent never sees them.

use crate::cel;
use crate::codegen;
use crate::daemon::{self, Request};
use crate::mcp;
use crate::translate::{self, Translator};
use crate::unit;
use anyhow::{bail, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, Write};

enum Route {
    // Checked: (translator, upstream).
    Translated(usize, usize),
    // Unchecked: (upstream).
    Hidden(usize),
}

struct Proxy {
    machine: String,
    role: String,
    cel: Option<cel::Backend>,
    translators: Vec<Translator>,
    upstreams: Vec<mcp::Client>,
    tools: Vec<Value>,
    routes: BTreeMap<String, Route>,
    // Why there are no tools, when there are none.
    problem: Option<String>,
}

pub fn serve() -> Result<()> {
    let mut proxy = match (std::env::var("COMPLIER_MACHINE"), std::env::var("COMPLIER_ROLE")) {
        (Ok(machine), Ok(role)) => Proxy::bind(machine.clone(), role.clone()).unwrap_or_else(|e| {
            eprintln!("complier proxy: {e:#}");
            Proxy::empty(machine, role, format!("{e:#}"))
        }),
        _ => Proxy::empty(String::new(), String::new(), "COMPLIER_MACHINE and COMPLIER_ROLE aren't set".into()),
    };

    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let message: Value = match serde_json::from_str(&line?) {
            Ok(message) => message,
            Err(_) => continue,
        };
        let Some(id) = message.get("id").cloned() else { continue }; // a notification
        let Some(method) = message["method"].as_str() else { continue }; // a response to us
        let reply = match proxy.handle(method, &message["params"]) {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32603, "message": format!("{e:#}") } }),
        };
        writeln!(stdout, "{reply}")?;
        stdout.flush()?;
    }
    Ok(())
}

impl Proxy {
    fn empty(machine: String, role: String, problem: String) -> Self {
        Self { machine, role, cel: None, translators: vec![], upstreams: vec![], tools: vec![], routes: BTreeMap::new(), problem: Some(problem) }
    }

    fn bind(machine: String, role: String) -> Result<Self> {
        let info = daemon::request(&Request::MachineInfo { machine: machine.clone(), role: role.clone() }, false)?;
        let mut proxy = Self::empty(machine, role, String::new());
        proxy.problem = None;
        let mut servers: BTreeMap<String, usize> = BTreeMap::new();

        // Every unit is loaded and proven before anything upstream is touched.
        let mut units = Vec::new();
        for path in info["units"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            let unit = unit::load(std::path::Path::new(path))?;
            let translated = match translate::admit(&unit, &mut proxy.cel)? {
                Some((translator, report)) => {
                    eprintln!("complier proxy: {path} admitted with {}", report.backend);
                    proxy.translators.push(translator);
                    Some(proxy.translators.len() - 1)
                }
                None => None,
            };
            units.push((unit, translated));
        }

        for (unit, translated) in units {
            let u = match servers.get(&unit.server) {
                Some(&u) => u,
                None => {
                    let mut client = crate::open(&unit.server)?;
                    client.initialize()?;
                    proxy.upstreams.push(client);
                    servers.insert(unit.server.clone(), proxy.upstreams.len() - 1);
                    proxy.upstreams.len() - 1
                }
            };

            for tool in proxy.upstreams[u].list_tools()? {
                let Some(name) = tool["name"].as_str().map(String::from) else { continue };
                let route = if let Some(t) = translated.filter(|&t| proxy.translators[t].translation.tools.contains(&name)) {
                    Route::Translated(t, u)
                } else if unit.hidden.contains(&name) {
                    Route::Hidden(u)
                } else {
                    continue;
                };
                // unit::load made sure every routed tool is in the service's metadata.
                let expected = &unit.hashes[&name];
                let live = codegen::hash(&tool["inputSchema"]);
                if &live != expected {
                    eprintln!("complier proxy: leaving out {name}: its schema changed since it was generated ({expected} -> {live})");
                    continue;
                }
                if proxy.routes.insert(name.clone(), route).is_some() {
                    bail!("two units both offer {name}");
                }
                proxy.tools.push(tool);
            }
        }
        Ok(proxy)
    }

    fn handle(&mut self, method: &str, params: &Value) -> Result<Value> {
        match method {
            "initialize" => Ok(json!({
                "protocolVersion": params["protocolVersion"].as_str().unwrap_or("2025-06-18"),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "complier", "version": env!("CARGO_PKG_VERSION") },
                "instructions": self.instructions(),
            })),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": self.tools })),
            "tools/call" => self.call(params["name"].as_str().unwrap_or_default(), &params["arguments"]),
            _ => bail!("method not found: {method}"),
        }
    }

    fn instructions(&self) -> String {
        match &self.problem {
            Some(problem) => format!("complier isn't bound to a machine, so it offers no tools: {problem}"),
            None => format!(
                "These tools are mediated by complier. You are role {} in machine {}; calls that change things are checked against the machine's spec first and refused if it doesn't allow them now.",
                self.role, self.machine
            ),
        }
    }

    fn call(&mut self, name: &str, args: &Value) -> Result<Value> {
        let refuse = |text: String| json!({ "content": [{ "type": "text", "text": text }], "isError": true });
        let upstream = match self.routes.get(name) {
            None => return Ok(refuse(format!("complier: {name} isn't available to role {}.", self.role))),
            Some(Route::Hidden(u)) => *u,
            Some(Route::Translated(t, u)) => {
                let (t, u) = (*t, *u);
                let cel = self.cel.as_mut().expect("a translated route has a CEL backend");
                let event = match self.translators[t].translate(cel, name, args)? {
                    Ok(event) => event,
                    Err(e) => return Ok(refuse(format!("complier: couldn't translate this {name} call: {e}"))),
                };
                let act = Request::Act {
                    machine: self.machine.clone(),
                    role: self.role.clone(),
                    event: event.channel.clone(),
                    value: event.value.clone(),
                };
                if let Err(e) = daemon::request(&act, false) {
                    return Ok(refuse(format!("complier refused this {name} call ({}): {e:#}", event.channel)));
                }
                u
            }
        };
        self.upstreams[upstream].call_tool(name, args.clone())
    }
}
