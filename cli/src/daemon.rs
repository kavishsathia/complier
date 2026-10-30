// The complier daemon: owns running machines. A machine is a spec's policy W as FDR compiled it
// (fdr.rs: FDR proves the policy, then normal(Policy) comes back as an explicit automaton), plus the
// spec's translation units. complier never interprets CSP: it only follows the automaton's edges.
//
// An agent's harness sends each tool call here before running it (`call`). The daemon translates it
// with the units into an action x and attempts it, as ControllableCHAOS does against W under
// prioritise:
// - if W's current state offers attempt.x, W takes it and answers with its own allow.x or deny.x
//   edge (FDR proved there is exactly one); the machine moves along both;
// - otherwise the attempt is refused, and W stays where it was.
// An allowed call runs, and the harness sends its result here afterwards (`result`). The unit turns
// it into a value v, and the machine follows W's result.x.v edge (FDR proved W accepts every value x
// can return). Until then, W takes no other attempt.
// Only an allowed call may run. Nothing else moves a machine: complier observes the world only
// through the results of calls it allowed.
// Clients talk to it over a Unix socket, one JSON request and one JSON response per line.

use crate::cel::Backend;
use crate::fdr::{self, Automaton};
use crate::translate::{self, Translator};
use crate::unit::{self, Unit};
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn dir() -> Result<PathBuf> {
    Ok(dirs::home_dir().context("no home directory")?.join(".complier"))
}

pub fn socket() -> Result<PathBuf> {
    Ok(dir()?.join("daemon.sock"))
}

pub fn log_path(machine: &str) -> Result<PathBuf> {
    Ok(dir()?.join("machines").join(format!("{machine}.log")))
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Ping,
    MachineUp { name: String, spec: PathBuf, units: Vec<PathBuf> },
    MachineDown { name: String },
    MachineLs,
    // A machine's units and what the agent may do next, for its session-start hook.
    MachineInfo { machine: String, role: String },
    // The agent is about to call the harness tool `tool`: may it? Translated by the machine's units
    // into an action, which is attempted on the policy. `tool_use_id` ties its result to it.
    Call {
        machine: String,
        role: String,
        tool: String,
        #[serde(default)]
        arguments: Value,
        #[serde(default)]
        tool_use_id: String,
    },
    // A call has finished: `ok` if it succeeded, with its output, or its error if it failed.
    // `value`, if given, is used as the result value as it is (for testing by hand).
    Result {
        machine: String,
        role: String,
        #[serde(default)]
        tool_use_id: String,
        #[serde(default)]
        ok: bool,
        #[serde(default)]
        output: String,
        #[serde(default)]
        error: String,
        #[serde(default)]
        value: Option<String>,
    },
    // The agent attempts the action `event` directly, as its hook would after translating a call
    // (its value only goes in the log).
    Act {
        machine: String,
        role: String,
        event: String,
        #[serde(default)]
        value: Value,
    },
    // The agent is stopping: wait while there's nothing it would be allowed to do, then report.
    Stop { machine: String, role: String },
}

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Status {
    Running,
    // The policy terminated (SKIP).
    Finished,
    // The policy takes no more attempts and can't terminate (STOP): every call is refused.
    Deadlocked,
    // A result came back that the policy doesn't accept: the unit and the spec's Returns disagree.
    Broken,
    Stopped,
}

// An allowed call whose result hasn't come back yet.
struct Pending {
    action: String,
    tool_use_id: String,
    // The unit that translated the call, which also translates its result; none for `machine act`.
    translator: Option<Arc<Translator>>,
}

struct Machine {
    spec: PathBuf,
    units: Vec<PathBuf>,
    // The admitted units, as they were when the machine started: later edits to their files don't
    // change what this machine allows.
    routes: Vec<UnitRoutes>,
    // The policy as FDR compiled it, and where it is now.
    automaton: Automaton,
    state: usize,
    acts: Vec<String>,
    pending: Option<Pending>,
    status: Status,
    log: File,
    // Why the machine left Running, and which agents have been told.
    ended: String,
    told_ended: BTreeSet<String>,
}

// One admitted unit: the service it covers, its proven translation (if it translates anything),
// and the read-only tools it passes through unchecked.
struct UnitRoutes {
    server: String,
    translator: Option<Arc<Translator>>,
    hidden: Vec<String>,
}

// Where a harness tool call goes.
enum Route {
    // Translated by this unit's translator, as the service's tool `tool`.
    Translated(Arc<Translator>, String),
    // Read-only, passed through unchecked.
    Hidden,
    // A tool of a service the units cover, but none of them names it.
    Unoffered(String, String),
    // Not a tool of any service the units cover.
    Unknown,
    // A built-in tool, in a machine none of whose units covers built-in tools: not complier's business.
    Unmediated,
}

// Claude Code's built-in tools (Bash, Edit, ...) are the service `claude-code`, called by their own
// names.
pub const BUILTIN: &str = "claude-code";

// A server's name as Claude Code writes it into tool names: anything but letters, digits, `_` and
// `-` becomes `_`.
fn harness_name(server: &str) -> String {
    server.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect()
}

// The service's tool a harness tool name calls, if it's one of `server`'s: `mcp__<server>__<tool>`,
// `mcp__plugin_<plugin>_<server>__<tool>` for a server a plugin provides, or the tool's own name for
// a built-in tool.
fn service_tool<'a>(name: &'a str, server: &str) -> Option<&'a str> {
    if server == BUILTIN {
        return (!name.starts_with("mcp__")).then_some(name);
    }
    let server = harness_name(server);
    let rest = name.strip_prefix("mcp__")?;
    if let Some(tool) = rest.strip_prefix(&format!("{server}__")) {
        return Some(tool);
    }
    let (head, tool) = rest.split_once("__")?;
    (head.starts_with("plugin_") && head.ends_with(&format!("_{server}"))).then_some(tool)
}

// What the policy did with an attempt.
#[derive(Debug, PartialEq)]
enum Verdict {
    Allowed,
    Denied,
    // The policy didn't take the attempt; its state is unchanged.
    Refused(String),
}

impl Machine {
    fn route(&self, name: &str) -> Route {
        let mut covered = None;
        for r in &self.routes {
            let Some(tool) = service_tool(name, &r.server) else { continue };
            if let Some(t) = r.translator.as_ref().filter(|t| t.translation.tools.iter().any(|x| x == tool)) {
                return Route::Translated(t.clone(), tool.to_string());
            }
            if r.hidden.iter().any(|h| h == tool) {
                return Route::Hidden;
            }
            covered = Some((r.server.clone(), tool.to_string()));
        }
        match covered {
            Some((server, tool)) => Route::Unoffered(server, tool),
            None if !name.starts_with("mcp__") => Route::Unmediated,
            None => Route::Unknown,
        }
    }

    fn edges(&self) -> &BTreeMap<String, usize> {
        &self.automaton.edges[self.state]
    }

    // The actions the agent would be allowed to take now: attempts W offers and would allow.
    fn next(&self) -> Vec<String> {
        self.edges()
            .iter()
            .filter_map(|(event, &after)| {
                let x = event.strip_prefix("attempt.")?;
                self.automaton.edges[after].contains_key(&format!("allow.{x}")).then(|| x.to_string())
            })
            .collect()
    }

    fn show(&self) -> String {
        match self.automaton.labels.get(self.state).filter(|l| !l.is_empty()) {
            Some(label) => label.clone(),
            None => format!("state {}", self.state),
        }
    }

    fn running(&self) -> Result<()> {
        match self.status {
            Status::Running => Ok(()),
            _ => bail!("the machine is {} ({})", serde_json::to_value(&self.status)?.as_str().unwrap_or("?"), self.ended),
        }
    }

    // The agent attempts `x`. Err only if the machine can't take attempts at all.
    fn act(&mut self, role: &str, x: &str, value: &Value, tool_use_id: &str, translator: Option<Arc<Translator>>) -> Result<Verdict> {
        let shown = match value {
            Value::Null => x.to_string(),
            Value::String(v) => format!("{x}.{v}"),
            v => format!("{x}.{v}"),
        };
        self.running()?;
        let verdict = if let Some(p) = &self.pending {
            Verdict::Refused(format!("the result of {} hasn't come back yet", p.action))
        } else if !self.acts.iter().any(|a| a == x) {
            Verdict::Refused(format!("{x} isn't an action of the spec (its Act doesn't list it)"))
        } else {
            match self.edges().get(&format!("attempt.{x}")).copied() {
                None => Verdict::Refused(format!("the policy doesn't take {x} now")),
                Some(taken) => {
                    let answers = &self.automaton.edges[taken];
                    match (answers.get(&format!("allow.{x}")), answers.get(&format!("deny.{x}"))) {
                        (Some(&next), None) => {
                            self.state = next;
                            self.pending = Some(Pending { action: x.to_string(), tool_use_id: tool_use_id.to_string(), translator });
                            Verdict::Allowed
                        }
                        (None, Some(&next)) => {
                            self.state = next;
                            Verdict::Denied
                        }
                        _ => bail!("FDR's automaton gives attempt.{x} no single verdict (state {taken}); this policy shouldn't have been admitted"),
                    }
                }
            }
        };
        let (outcome, reason) = match &verdict {
            Verdict::Allowed => ("allowed", String::new()),
            Verdict::Denied => ("denied", format!("the policy denied {x}")),
            Verdict::Refused(reason) => ("refused", reason.clone()),
        };
        self.record(json!({ "kind": "act", "role": role, "event": shown, "outcome": outcome, "reason": reason, "state": self.show() }));
        self.check_end();
        Ok(verdict)
    }

    // The pending call's result came back as `value`: W follows result.x.value.
    fn result(&mut self, value: &str) -> Result<()> {
        let Some(p) = self.pending.take() else { bail!("no call is waiting for a result") };
        let event = format!("result.{}.{value}", p.action);
        match self.edges().get(&event).copied() {
            Some(next) => {
                self.state = next;
                self.record(json!({ "kind": "result", "event": event, "state": self.show() }));
                self.check_end();
                Ok(())
            }
            None => {
                let reason = format!("{} returned {value}, which the policy doesn't accept: the unit and the spec's Returns({}) disagree", p.action, p.action);
                self.set(Status::Broken, &reason);
                bail!("{reason}")
            }
        }
    }

    // What the agent may do now, for its Stop hook.
    fn catch_up(&self) -> Value {
        json!({ "happened": [], "next": self.next() })
    }

    // Whether the agent has nothing it would be allowed to do yet.
    fn waiting(&self) -> bool {
        self.status == Status::Running && self.pending.is_none() && self.next().is_empty()
    }

    // Ends the machine once the policy can take no more attempts or results: finished if it terminated.
    fn check_end(&mut self) {
        if self.status != Status::Running {
            return;
        }
        let edges = self.edges();
        if edges.keys().any(|e| e.starts_with("attempt.") || e.starts_with("result.")) {
            return;
        }
        match edges.contains_key("✓") {
            true => self.set(Status::Finished, "the policy terminated"),
            false => self.set(Status::Deadlocked, "the policy takes no more attempts"),
        }
    }

    fn set(&mut self, status: Status, reason: &str) {
        self.status = status.clone();
        self.ended = reason.to_string();
        self.record(json!({ "kind": "status", "status": status, "reason": reason }));
    }

    fn record(&mut self, mut entry: Value) {
        entry["t"] = json!(SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64);
        let _ = writeln!(self.log, "{entry}");
    }
}

// The daemon's state: its machines, and the CEL backend that translates their agents' calls and
// results, started the first time it's needed and kept for the next.
#[derive(Default)]
pub struct Daemon {
    machines: Mutex<BTreeMap<String, Machine>>,
    cel: Mutex<Option<Backend>>,
}

impl Daemon {
    // Runs `f` with the CEL backend, starting it if needed and dropping it if it failed.
    fn with_cel<T>(&self, f: impl FnOnce(&mut Backend) -> Result<T>) -> Result<T> {
        let mut cel = self.cel.lock().unwrap();
        if cel.is_none() {
            *cel = Some(Backend::spawn()?);
        }
        let out = f(cel.as_mut().unwrap());
        if out.is_err() {
            *cel = None;
        }
        out
    }
}

// Runs the daemon in the foreground until killed.
pub fn serve() -> Result<()> {
    let path = socket()?;
    std::fs::create_dir_all(dir()?.join("machines"))?;
    if path.exists() {
        if UnixStream::connect(&path).is_ok() {
            bail!("a complier daemon is already running");
        }
        std::fs::remove_file(&path)?; // left behind by a daemon that didn't exit cleanly
    }
    let listener = UnixListener::bind(&path)?;
    println!("complier daemon listening on {}", path.display());

    let daemon: Arc<Daemon> = Arc::default();
    for stream in listener.incoming() {
        let daemon = daemon.clone();
        std::thread::spawn(move || {
            if let Err(e) = handle(stream?, &daemon) {
                eprintln!("client error: {e:#}");
            }
            anyhow::Ok(())
        });
    }
    Ok(())
}

fn handle(stream: UnixStream, daemon: &Daemon) -> Result<()> {
    let mut line = String::new();
    BufReader::new(&stream).read_line(&mut line)?;
    let response = match serde_json::from_str::<Request>(&line) {
        Ok(request) => match respond(request, daemon) {
            Ok(value) => json!({ "ok": value }),
            Err(e) => json!({ "error": format!("{e:#}") }),
        },
        Err(e) => json!({ "error": format!("bad request: {e}") }),
    };
    writeln!(&stream, "{response}")?;
    Ok(())
}

fn respond(request: Request, daemon: &Daemon) -> Result<Value> {
    let machines = &daemon.machines;
    match request {
        Request::Ping => Ok(json!("pong")),
        Request::MachineUp { name, spec, units } => machine_up(daemon, name, &spec, units),
        Request::Call { machine, role, tool, arguments, tool_use_id } => call(daemon, &machine, &role, &tool, &arguments, &tool_use_id),
        Request::Result { machine, role: _, tool_use_id, ok, output, error, value } => result(daemon, &machine, &tool_use_id, ok, &output, &error, value),
        Request::MachineDown { name } => {
            let mut all = machines.lock().unwrap();
            let mut machine = all.remove(&name).ok_or_else(|| anyhow!("no machine named {name}"))?;
            machine.set(Status::Stopped, "stopped by machine down");
            println!("machine {name} stopped");
            Ok(json!(name))
        }
        Request::MachineLs => {
            let all = machines.lock().unwrap();
            Ok(all
                .iter()
                .map(|(name, m)| {
                    json!({ "name": name, "status": m.status, "state": m.show(), "spec": m.spec })
                })
                .collect())
        }
        Request::MachineInfo { machine, role: _ } => {
            let all = machines.lock().unwrap();
            let m = all.get(&machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
            Ok(json!({ "status": m.status, "units": m.units, "next": m.next() }))
        }
        Request::Act { machine, role, event, value } => {
            let mut all = machines.lock().unwrap();
            let m = all.get_mut(&machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
            let verdict = match m.act(&role, &event, &value, "", None)? {
                Verdict::Allowed => json!({ "verdict": "allowed" }),
                Verdict::Denied => json!({ "verdict": "denied", "reason": format!("the policy denied {event}") }),
                Verdict::Refused(reason) => json!({ "verdict": "refused", "reason": reason }),
            };
            Ok(json!({ "state": m.show(), "verdict": verdict["verdict"], "reason": verdict["reason"] }))
        }
        Request::Stop { machine, role } => loop {
            {
                let mut all = machines.lock().unwrap();
                let Some(m) = all.get_mut(&machine) else { return Ok(json!({ "happened": [], "note": format!("no machine named {machine}") })) };
                // Tell the agent once that its machine is no longer running, so it can tell its user.
                if m.status != Status::Running && m.status != Status::Finished && m.told_ended.insert(role.clone()) {
                    return Ok(json!({ "happened": [], "ended": m.status, "reason": m.ended }));
                }
                if !m.waiting() {
                    return Ok(m.catch_up());
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        },
    }
}

// Decides one harness tool call: {"allow": true, ...} or {"allow": false, "reason"}. A translated
// call's action is attempted on the machine before the answer, so a call that is allowed has already
// moved the policy, which then waits for its result. Err means nothing could be decided (no such
// machine, or the CEL backend failed); the hook refuses the call then too.
fn call(daemon: &Daemon, machine: &str, role: &str, name: &str, args: &Value, tool_use_id: &str) -> Result<Value> {
    let deny = |reason: String| Ok(json!({ "allow": false, "reason": reason }));
    let route = {
        let all = daemon.machines.lock().unwrap();
        let m = all.get(machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
        m.route(name)
    };
    let (translator, tool) = match route {
        Route::Hidden => return Ok(json!({ "allow": true, "hidden": true })),
        Route::Unmediated => return Ok(json!({ "allow": true, "unmediated": true })),
        Route::Unknown => {
            return deny(format!("{name} isn't a tool of any service machine {machine}'s units cover; inside a complier machine only the tools its units name are allowed."))
        }
        Route::Unoffered(server, tool) => return deny(format!("{tool} isn't named by any of machine {machine}'s units for {server}, so it isn't available.")),
        Route::Translated(translator, tool) => (translator, tool),
    };
    let event = match daemon.with_cel(|cel| translator.translate(cel, &tool, args))? {
        Ok(event) => event,
        Err(e) => return deny(format!("couldn't translate this {tool} call: {e}")),
    };
    let mut all = daemon.machines.lock().unwrap();
    let m = all.get_mut(machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
    match m.act(role, &event.channel, &event.value, tool_use_id, Some(translator))? {
        Verdict::Allowed => Ok(json!({ "allow": true, "event": translate::show(&event) })),
        Verdict::Denied => deny(format!("the policy denied this {tool} call ({}).", event.channel)),
        Verdict::Refused(reason) => deny(format!("refused this {tool} call ({}): {reason}.", event.channel)),
    }
}

// A call finished. If it's the call the machine is waiting for, its result is translated into a
// value and the policy follows result.x.value; results of calls complier didn't mediate are ignored.
fn result(daemon: &Daemon, machine: &str, tool_use_id: &str, ok: bool, output: &str, error: &str, value: Option<String>) -> Result<Value> {
    let (action, translator) = {
        let all = daemon.machines.lock().unwrap();
        let m = all.get(machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
        match &m.pending {
            Some(p) if p.tool_use_id == tool_use_id || value.is_some() => (p.action.clone(), p.translator.clone()),
            _ => return Ok(json!({ "ignored": true })),
        }
    };
    let value = match (value, translator) {
        (Some(v), _) => v,
        (None, Some(t)) => match daemon.with_cel(|cel| t.result(cel, &action, ok, output, error))? {
            Ok(v) => v,
            Err(e) => {
                let mut all = daemon.machines.lock().unwrap();
                let m = all.get_mut(machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
                let reason = format!("couldn't translate the result of {action}: {e}");
                m.pending = None;
                m.set(Status::Broken, &reason);
                bail!("{reason}")
            }
        },
        (None, None) => bail!("{action} was attempted by hand; give its result with `complier machine result`"),
    };
    let mut all = daemon.machines.lock().unwrap();
    let m = all.get_mut(machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
    m.result(&value)?;
    Ok(json!({ "action": action, "value": value, "state": m.show() }))
}

fn machine_up(daemon: &Daemon, name: String, spec: &Path, units: Vec<PathBuf>) -> Result<Value> {
    // FDR proves the policy and compiles it; the units are proven by the CEL backend.
    let compiled = match fdr::compile(spec)? {
        Ok(compiled) => compiled,
        Err(report) => bail!("{} isn't admitted:\n{report}", spec.display()),
    };
    let admitted = admit(&units)?;
    if daemon.machines.lock().unwrap().contains_key(&name) {
        bail!("a machine named {name} is already running");
    }

    let log = OpenOptions::new().create(true).append(true).open(log_path(&name)?)?;
    let mut machine = Machine {
        spec: spec.to_path_buf(),
        units: units.clone(),
        routes: Vec::new(),
        state: compiled.automaton.root,
        automaton: compiled.automaton,
        acts: compiled.acts,
        pending: None,
        status: Status::Running,
        log,
        ended: String::new(),
        told_ended: Default::default(),
    };
    machine.record(json!({ "kind": "status", "status": Status::Running, "reason": "machine up", "state": machine.show() }));
    machine.record(json!({ "kind": "policy", "spec": spec, "states": machine.automaton.edges.len(), "report": compiled.report.to_string() }));
    for a in admitted {
        machine.record(json!({ "kind": "admission", "unit": a.path, "report": a.report }));
        if let Some(t) = &a.translator {
            let tr = &t.translation;
            let emits = tr.rules.iter().map(|r| r.emit.as_str()).chain([tr.fallback.emit.as_str()]);
            for e in emits.filter(|e| !machine.acts.iter().any(|a| a == e)).collect::<BTreeSet<_>>() {
                let warning = format!("{} emits {e}, which isn't in the spec's Act, so calls translated to it are always refused", a.path.display());
                machine.record(json!({ "kind": "warning", "warning": warning }));
            }
        }
        machine.routes.push(UnitRoutes { server: a.unit.server, translator: a.translator.map(Arc::new), hidden: a.unit.hidden });
    }
    machine.check_end();
    let mut all = daemon.machines.lock().unwrap();
    if all.contains_key(&name) {
        bail!("a machine named {name} is already running");
    }
    all.insert(name.clone(), machine);
    println!("machine {name} up");
    Ok(json!(name))
}

// Loads and admits each unit before the machine starts: its YAML read and checked against its
// service (unit::load), and its translation proven by the CEL backend (translate::admit). The first
// unit that isn't admitted keeps the machine from starting, and the reason, with any witness the
// solver found, goes back to whoever asked.
// A tool two units both name is refused here too. The CEL backend that proves them is stopped once
// they're admitted; the daemon starts its own when an agent's first call needs translating.
struct Admitted {
    path: PathBuf,
    unit: Unit,
    translator: Option<Translator>,
    report: Option<String>,
}

fn admit(units: &[PathBuf]) -> Result<Vec<Admitted>> {
    let mut cel = None;
    let mut offered: BTreeMap<(String, String), &Path> = BTreeMap::new();
    units
        .iter()
        .map(|path| {
            let unit = unit::load(path).with_context(|| format!("{} isn't admitted", path.display()))?;
            for tool in unit.tools() {
                if let Some(other) = offered.insert((unit.server.clone(), tool.to_string()), path) {
                    bail!("{} isn't admitted: {tool} is also offered by {}; each tool can be in only one unit", path.display(), other.display());
                }
            }
            let admitted = translate::admit(&unit, &mut cel).with_context(|| format!("{} isn't admitted", path.display()))?;
            let (translator, report) = match admitted {
                Some((translator, report)) => (Some(translator), Some(report.to_string())),
                None => (None, None),
            };
            Ok(Admitted { path: path.clone(), unit, translator, report })
        })
        .collect()
}

// Sends one request to the daemon, starting it in the background first if it isn't running
// and `start` is set.
pub fn request(request: &Request, start: bool) -> Result<Value> {
    let path = socket()?;
    let stream = match UnixStream::connect(&path) {
        Ok(stream) => stream,
        Err(_) if start => start_background(&path)?,
        Err(_) => bail!("the complier daemon isn't running"),
    };
    writeln!(&stream, "{}", serde_json::to_string(request)?)?;
    let mut line = String::new();
    BufReader::new(&stream).read_line(&mut line)?;
    let mut response: Value = serde_json::from_str(&line)?;
    match response.get("error").and_then(Value::as_str) {
        Some(error) => Err(anyhow!("{error}")),
        None => Ok(response["ok"].take()),
    }
}

fn start_background(path: &Path) -> Result<UnixStream> {
    use std::os::unix::process::CommandExt;
    let log = OpenOptions::new().create(true).append(true).open(dir()?.join("daemon.log"))?;
    std::process::Command::new(std::env::current_exe()?)
        .arg("up")
        .stdin(std::process::Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log)
        .process_group(0) // its own group, so closing this terminal doesn't take it down
        .spawn()
        .context("starting the complier daemon")?;
    for _ in 0..50 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if let Ok(stream) = UnixStream::connect(path) {
            eprintln!("started the complier daemon (logs: ~/.complier/daemon.log)");
            return Ok(stream);
        }
    }
    bail!("the complier daemon didn't start; see ~/.complier/daemon.log")
}

#[cfg(test)]
mod tests {
    use super::*;

    // normal(Policy) for: Permit(check_time, \ v @ (if v == failed then Policy else W(v))), where
    // W(v) permits one edit and then stops. Written out by hand so these tests don't need FDR;
    // tests/e2e.rs runs the real thing.
    //   0 --attempt.check_time--> 1 --allow.check_time--> 2 --result.check_time.{ok,failed}--> 3 / 0
    //   3 --attempt.edit--> 4 --allow.edit--> 5 --result.edit.done--> 6 (no more attempts)
    //   3 --attempt.push--> 7 --deny.push--> 3
    fn machine() -> Machine {
        let t = [
            (0, "attempt.check_time", 1),
            (1, "allow.check_time", 2),
            (2, "result.check_time.ok", 3),
            (2, "result.check_time.failed", 0),
            (3, "attempt.edit", 4),
            (4, "allow.edit", 5),
            (5, "result.edit.done", 6),
            (3, "attempt.push", 7),
            (7, "deny.push", 3),
        ];
        let automaton = Automaton::from_transitions(vec![String::new(); 8], 0, &t);
        let log = std::env::temp_dir().join(format!("complier-test-{}.log", std::process::id()));
        Machine {
            spec: PathBuf::new(),
            units: Vec::new(),
            routes: Vec::new(),
            state: 0,
            automaton,
            acts: ["check_time", "edit", "push"].map(String::from).to_vec(),
            pending: None,
            status: Status::Running,
            log: File::create(log).unwrap(),
            ended: String::new(),
            told_ended: Default::default(),
        }
    }

    #[test]
    fn an_allowed_call_waits_for_its_result_and_the_result_decides() {
        let mut m = machine();
        assert_eq!(m.next(), ["check_time"]);
        assert_eq!(m.act("dev", "check_time", &Value::Null, "t1", None).unwrap(), Verdict::Allowed);
        // While the result is outstanding, nothing else is taken.
        assert!(matches!(m.act("dev", "edit", &Value::Null, "t2", None).unwrap(), Verdict::Refused(r) if r.contains("hasn't come back")));
        assert!(!m.waiting());
        // A failed reading sends the policy back to the start.
        m.result("failed").unwrap();
        assert_eq!(m.state, 0);
        m.act("dev", "check_time", &Value::Null, "t3", None).unwrap();
        m.result("ok").unwrap();
        assert_eq!(m.next(), ["edit"]);
        // Denied: answered and the state moves along deny; refused: not taken, state kept.
        assert_eq!(m.act("dev", "push", &Value::Null, "t4", None).unwrap(), Verdict::Denied);
        assert!(matches!(m.act("dev", "check_time", &Value::Null, "t5", None).unwrap(), Verdict::Refused(r) if r.contains("doesn't take check_time")));
        assert!(matches!(m.act("dev", "delete", &Value::Null, "t6", None).unwrap(), Verdict::Refused(r) if r.contains("isn't an action")));
        assert_eq!(m.act("dev", "edit", &Value::Null, "t7", None).unwrap(), Verdict::Allowed);
        assert!(m.status == Status::Running); // still waiting for edit's result
        m.result("done").unwrap();
        assert!(m.status == Status::Deadlocked);
        assert!(m.act("dev", "edit", &Value::Null, "t8", None).is_err());
    }

    #[test]
    fn a_result_the_policy_doesnt_accept_breaks_the_machine() {
        let mut m = machine();
        m.act("dev", "check_time", &Value::Null, "t1", None).unwrap();
        let e = m.result("minutes.7").unwrap_err().to_string();
        assert!(e.contains("doesn't accept") && e.contains("Returns(check_time)"), "{e}");
        assert!(m.status == Status::Broken);
        assert!(m.result("ok").is_err()); // nothing is pending any more
    }

    #[test]
    fn a_stopping_agent_is_told_once_that_its_machine_ended() {
        let mut m = machine();
        m.set(Status::Deadlocked, "the policy takes no more attempts");
        let daemon = Daemon { machines: Mutex::new([("demo".to_string(), m)].into()), cel: Mutex::new(None) };
        let stop = || respond(Request::Stop { machine: "demo".into(), role: "dev".into() }, &daemon).unwrap();
        let first = stop();
        assert_eq!(first["ended"], json!("deadlocked"));
        assert!(first["reason"].as_str().unwrap().contains("no more attempts"));
        assert!(stop().get("ended").is_none()); // told once; after that it may stop
    }

    #[test]
    fn harness_tool_names_are_matched_to_services() {
        assert_eq!(service_tool("mcp__notion__notion-update-page", "notion"), Some("notion-update-page"));
        assert_eq!(service_tool("mcp__plugin_acme_notion__notion-fetch", "notion"), Some("notion-fetch"));
        assert_eq!(service_tool("mcp__claude_ai_Notion__notion-fetch", "claude.ai Notion"), Some("notion-fetch"));
        assert_eq!(service_tool("mcp__claude-in-chrome__navigate", "claude-in-chrome"), Some("navigate"));
        assert_eq!(service_tool("mcp__notionx__notion-fetch", "notion"), None);
        assert_eq!(service_tool("Bash", "notion"), None);
        assert_eq!(service_tool("Bash", BUILTIN), Some("Bash"));
        assert_eq!(service_tool("mcp__notion__x", BUILTIN), None);

        let mut m = machine();
        m.routes.push(UnitRoutes { server: "notion".into(), translator: None, hidden: vec!["notion-fetch".into()] });
        assert!(matches!(m.route("mcp__notion__notion-fetch"), Route::Hidden));
        assert!(matches!(m.route("mcp__notion__notion-delete"), Route::Unoffered(s, t) if s == "notion" && t == "notion-delete"));
        assert!(matches!(m.route("mcp__github__create_issue"), Route::Unknown));
        assert!(matches!(m.route("Bash"), Route::Unmediated)); // no unit covers built-in tools here
        m.routes.push(UnitRoutes { server: BUILTIN.into(), translator: None, hidden: vec!["Read".into()] });
        assert!(matches!(m.route("Read"), Route::Hidden));
        assert!(matches!(m.route("Bash"), Route::Unoffered(s, _) if s == BUILTIN));
    }
}
