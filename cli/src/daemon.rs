// The complier daemon: owns running machines, each a spec instance (a || composition of
// components) whose state advances on two kinds of event:
// - outputs (`!e`), actions an agent submits through its role's component: its harness's
//   pre-tool-use hook sends each MCP tool call here (`call`), the daemon translates it into an
//   event with the machine's units, and the call may run only if the event is enabled;
// - internal events (everything else), performed by the daemon as soon as they're enabled.
// Nothing else moves a machine: complier doesn't observe the world, so a spec that marks an input
// (`?e`) is refused, since nothing would ever submit it.
// An agent's Stop hook only reports: it waits while the agent's process has nothing for it to
// submit, then tells it what its process went through.
// Clients talk to it over a Unix socket, one JSON request and one JSON response per line.

use crate::cel::Backend;
use crate::csp::{self, Contract, Term};
use crate::translate::{self, Translator};
use crate::unit::{self, Unit};
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
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
    // A machine's units and what a role may do next, for an agent's session-start hook.
    MachineInfo { machine: String, role: String },
    // An agent in `role` is about to call the harness tool `tool` (`mcp__<server>__<tool>`): may
    // it? Translated by the machine's units into an event, which is performed if the spec allows it.
    Call {
        machine: String,
        role: String,
        tool: String,
        #[serde(default)]
        arguments: Value,
    },
    // An agent in `role` performs `event` (its value only goes in the log).
    Act {
        machine: String,
        role: String,
        event: String,
        #[serde(default)]
        value: Value,
    },
    // An agent in `role` is stopping: wait while it has nothing to submit, then report what its
    // process went through since it last stopped.
    Stop { machine: String, role: String },
}

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Status {
    Running,
    // The spec terminated (SKIP).
    Finished,
    // The spec can do nothing more and cannot terminate (STOP).
    Deadlocked,
    // Internal events alone could go on forever (CSP divergence).
    Diverged,
    Stopped,
}

struct Machine {
    spec: PathBuf,
    units: Vec<PathBuf>,
    // The admitted units, as they were when the machine started: later edits to their files don't
    // change what this machine allows.
    routes: Vec<UnitRoutes>,
    contract: Contract,
    // One state per component, in the order of contract.components.
    states: Vec<Vec<Term>>,
    status: Status,
    log: File,
    // Per component, the events it took part in with the role that submitted each (none for
    // internal events).
    history: Vec<Vec<(String, Option<String>)>>,
    // How much of its component's history each role has been told about.
    told: BTreeMap<String, usize>,
    // Why the machine left Running, and which roles have been told.
    ended: String,
    told_ended: std::collections::BTreeSet<String>,
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
}

// A server's name as Claude Code writes it into tool names: anything but letters, digits, `_` and
// `-` becomes `_`.
fn harness_name(server: &str) -> String {
    server.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect()
}

// The service's tool a harness tool name calls, if it's one of `server`'s: `mcp__<server>__<tool>`,
// or `mcp__plugin_<plugin>_<server>__<tool>` for a server a plugin provides.
fn service_tool<'a>(name: &'a str, server: &str) -> Option<&'a str> {
    let server = harness_name(server);
    let rest = name.strip_prefix("mcp__")?;
    if let Some(tool) = rest.strip_prefix(&format!("{server}__")) {
        return Some(tool);
    }
    let (head, tool) = rest.split_once("__")?;
    (head.starts_with("plugin_") && head.ends_with(&format!("_{server}"))).then_some(tool)
}

// How many internal events in a row count as divergence.
const MAX_INTERNAL: usize = 10_000;

impl Machine {
    fn participants(&self, event: &str) -> Vec<usize> {
        (0..self.states.len()).filter(|&i| self.contract.components[i].alphabet.contains(event)).collect()
    }

    // An event happens only when every component that shares it can take part.
    fn enabled(&self, event: &str) -> bool {
        let parts = self.participants(event);
        !parts.is_empty() && parts.iter().all(|&i| self.contract.initials(&self.states[i]).contains(event))
    }

    // `shown` is the event with its value, for reports; `by` is the role that submitted it.
    fn perform(&mut self, event: &str, shown: &str, by: Option<&str>) {
        for i in self.participants(event) {
            self.states[i] = self.contract.after(&self.states[i], event);
            self.history[i].push((shown.to_string(), by.map(String::from)));
        }
    }

    // What the role can submit next.
    fn next(&self, i: usize) -> Vec<String> {
        let outputs = &self.contract.outputs;
        self.contract.initials(&self.states[i]).into_iter().filter(|e| outputs.contains(e)).collect()
    }

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
            None => Route::Unknown,
        }
    }

    fn component(&self, role: &str) -> Result<usize> {
        self.contract
            .components
            .iter()
            .position(|c| c.name.eq_ignore_ascii_case(role))
            .ok_or_else(|| anyhow!("the spec has no process for role {role}"))
    }

    fn show(&self) -> String {
        let parts = self.contract.components.iter().zip(&self.states);
        parts.map(|(c, s)| format!("{}: {}", c.name, csp::show_state(s))).collect::<Vec<_>>().join("  ||  ")
    }

    // A refused action is just refused (fail closed).
    fn act(&mut self, role: &str, event: &str, value: &Value) -> Result<()> {
        let shown = match value {
            Value::Null => event.to_string(),
            Value::String(v) => format!("{event}.{v}"),
            v => format!("{event}.{v}"),
        };
        if self.status != Status::Running {
            bail!("the machine is {}", serde_json::to_value(&self.status)?.as_str().unwrap_or("?"));
        }
        let component = &self.contract.components[self.component(role)?];
        let outcome = if !component.alphabet.contains(event) {
            Err(format!("{event} isn't something role {role} does"))
        } else if !self.contract.outputs.contains(event) {
            Err(format!("{event} is internal to the spec (not marked !), so only the spec performs it"))
        } else if !self.enabled(event) {
            Err(format!("the spec doesn't allow {event} now"))
        } else {
            Ok(())
        };
        if let Err(reason) = outcome {
            self.record(json!({ "kind": "act", "role": role, "event": shown, "outcome": "refused", "reason": reason }));
            bail!("{reason}");
        }
        self.perform(event, &shown, Some(role));
        self.record(json!({ "kind": "act", "role": role, "event": shown, "outcome": "accepted", "state": self.show() }));
        self.advance();
        Ok(())
    }

    // What the role's process went through since the role was last told, leaving out its own
    // actions: internal events and other roles' actions on events it shares.
    fn catch_up(&mut self, role: &str) -> Result<Value> {
        let i = self.component(role)?;
        let told = self.told.get(role).copied().unwrap_or_default();
        let happened: Vec<&String> = self.history[i][told..].iter().filter(|(_, by)| by.as_deref() != Some(role)).map(|(e, _)| e).collect();
        let report = json!({ "happened": happened, "next": self.next(i) });
        self.told.insert(role.to_string(), self.history[i].len());
        Ok(report)
    }

    // Whether the role has nothing to submit and something else may still happen.
    fn waiting(&self, role: &str) -> Result<bool> {
        Ok(self.status == Status::Running && self.next(self.component(role)?).is_empty())
    }

    // After any step: performs internal events while one is enabled, then ends the machine if
    // nothing more can happen. When several are enabled, which one goes first is an internal
    // choice, and the daemon takes the first by name.
    fn advance(&mut self) {
        for _ in 0..MAX_INTERNAL {
            if self.status != Status::Running {
                return;
            }
            let outputs = &self.contract.outputs;
            let ready = self.contract.alphabet.iter().find(|e| !outputs.contains(*e) && self.enabled(e)).cloned();
            let Some(event) = ready else { return self.check_end() };
            self.perform(&event, &event, None);
            self.record(json!({ "kind": "internal", "event": event, "state": self.show() }));
        }
        self.set(Status::Diverged, &format!("{MAX_INTERNAL} internal events in a row with nothing from outside"));
    }

    // Ends the machine once nothing can happen: finished if every component can terminate.
    fn check_end(&mut self) {
        if self.contract.alphabet.iter().any(|e| self.enabled(e)) {
            return;
        }
        match self.states.iter().all(|s| self.contract.can_finish(s)) {
            true => self.set(Status::Finished, "the spec terminated"),
            false => self.set(Status::Deadlocked, "the spec can do nothing more"),
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

// The daemon's state: its machines, and the CEL backend that translates their agents' calls,
// started on the first call that needs it and kept for the next.
#[derive(Default)]
pub struct Daemon {
    machines: Mutex<BTreeMap<String, Machine>>,
    cel: Mutex<Option<Backend>>,
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
        Request::Call { machine, role, tool, arguments } => call(daemon, &machine, &role, &tool, &arguments),
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
        Request::MachineInfo { machine, role } => {
            let all = machines.lock().unwrap();
            let m = all.get(&machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
            let i = m.component(&role)?;
            Ok(json!({ "status": m.status, "units": m.units, "next": m.next(i) }))
        }
        Request::Act { machine, role, event, value } => {
            let mut all = machines.lock().unwrap();
            let m = all.get_mut(&machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
            m.act(&role, &event, &value)?;
            Ok(json!(m.show()))
        }
        Request::Stop { machine, role } => loop {
            {
                let mut all = machines.lock().unwrap();
                let Some(m) = all.get_mut(&machine) else { return Ok(json!({ "happened": [], "note": format!("no machine named {machine}") })) };
                // Tell each role once that its machine is no longer running, so it can tell its user.
                if m.status != Status::Running && m.status != Status::Finished && m.told_ended.insert(role.clone()) {
                    return Ok(json!({ "happened": [], "ended": m.status, "reason": m.ended }));
                }
                if !m.waiting(&role)? {
                    return m.catch_up(&role);
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        },
    }
}

// Decides one harness tool call for an agent in `role`: {"allow": true, ...} or {"allow": false,
// "reason"}. A translated call's event is performed on the machine before the answer, so a call that
// is allowed has already moved the spec. Err means nothing could be decided (no such machine or
// role, or the CEL backend failed); the hook refuses the call then too.
fn call(daemon: &Daemon, machine: &str, role: &str, name: &str, args: &Value) -> Result<Value> {
    let deny = |reason: String| Ok(json!({ "allow": false, "reason": reason }));
    let route = {
        let all = daemon.machines.lock().unwrap();
        let m = all.get(machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
        m.component(role)?;
        m.route(name)
    };
    let (translator, tool) = match route {
        Route::Hidden => return Ok(json!({ "allow": true, "hidden": true })),
        Route::Unknown => {
            return deny(format!("{name} isn't a tool of any service machine {machine}'s units cover; inside a complier machine only the tools its units name are allowed."))
        }
        Route::Unoffered(server, tool) => return deny(format!("{tool} isn't named by any of machine {machine}'s units for {server}, so it isn't available to role {role}.")),
        Route::Translated(translator, tool) => (translator, tool),
    };
    let translated = {
        let mut cel = daemon.cel.lock().unwrap();
        if cel.is_none() {
            *cel = Some(Backend::spawn()?);
        }
        let result = translator.translate(cel.as_mut().unwrap(), &tool, args);
        if result.is_err() {
            *cel = None; // the backend failed; start a fresh one for the next call
        }
        result?
    };
    let event = match translated {
        Ok(event) => event,
        Err(e) => return deny(format!("couldn't translate this {tool} call: {e}")),
    };
    let mut all = daemon.machines.lock().unwrap();
    let m = all.get_mut(machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
    match m.act(role, &event.channel, &event.value) {
        Ok(()) => Ok(json!({ "allow": true, "event": translate::show(&event) })),
        Err(e) => deny(format!("refused this {tool} call ({}): {e:#}", event.channel)),
    }
}

fn machine_up(daemon: &Daemon, name: String, spec: &Path, units: Vec<PathBuf>) -> Result<Value> {
    let source = std::fs::read_to_string(spec).with_context(|| format!("reading {}", spec.display()))?;
    let contract = csp::parse(&source).map_err(|e| anyhow!("{}: {e}", spec.display()))?;
    no_inputs(&contract).map_err(|e| anyhow!("{}: {e}", spec.display()))?;
    let admitted = admit(&units)?;
    let mut all = daemon.machines.lock().unwrap();
    if all.contains_key(&name) {
        bail!("a machine named {name} is already running");
    }

    let log = OpenOptions::new().create(true).append(true).open(log_path(&name)?)?;
    let states = contract.initial_states();
    let history = vec![Vec::new(); states.len()];
    let mut machine = Machine {
        history,
        spec: spec.to_path_buf(),
        units: units.clone(),
        routes: Vec::new(),
        contract,
        states,
        status: Status::Running,
        log,
        told: BTreeMap::new(),
        ended: String::new(),
        told_ended: Default::default(),
    };
    machine.record(json!({ "kind": "status", "status": Status::Running, "reason": "machine up", "state": machine.show() }));
    for a in admitted {
        machine.record(json!({ "kind": "admission", "unit": a.path, "report": a.report }));
        machine.routes.push(UnitRoutes { server: a.unit.server, translator: a.translator.map(Arc::new), hidden: a.unit.hidden });
    }
    machine.advance();
    all.insert(name.clone(), machine);
    println!("machine {name} up");
    Ok(json!(name))
}

// Nothing outside an agent submits events, so an input (`?e`) could never happen.
fn no_inputs(contract: &Contract) -> Result<()> {
    match contract.inputs.iter().next() {
        Some(e) => bail!("?{e} marks an input from the world, but complier doesn't observe the world, so nothing would ever submit it; agents' actions are outputs (!{e})"),
        None => Ok(()),
    }
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

    // The writer drafts, the spec files the draft on its own, and only then may the writer recreate.
    const SPEC: &str = "
        WRITER  = !draft -> filed -> !recreate -> WRITER
        ARCHIVE = filed -> ARCHIVE
        MAIN    = WRITER || ARCHIVE";

    fn machine() -> Machine {
        spec_machine(SPEC)
    }

    fn spec_machine(spec: &str) -> Machine {
        let contract = csp::parse(spec).unwrap();
        let log = std::env::temp_dir().join(format!("complier-test-{}.log", std::process::id()));
        Machine {
            spec: PathBuf::new(),
            units: Vec::new(),
            routes: Vec::new(),
            states: contract.initial_states(),
            history: vec![Vec::new(); contract.components.len()],
            contract,
            status: Status::Running,
            log: File::create(log).unwrap(),
            told: BTreeMap::new(),
            ended: String::new(),
            told_ended: Default::default(),
        }
    }

    #[test]
    fn internal_events_happen_on_their_own_and_are_reported() {
        let mut m = machine();
        assert!(!m.waiting("writer").unwrap()); // it can draft, so its stop isn't held
        m.act("writer", "draft", &json!("p1")).unwrap(); // filed happens with it, internally
        assert!(m.status == Status::Running);
        let report = m.catch_up("writer").unwrap();
        assert_eq!(report["happened"], json!(["filed"])); // its own draft is left out
        assert_eq!(report["next"], json!(["recreate"]));
        assert!(report.get("world").is_none());
        assert_eq!(m.catch_up("writer").unwrap()["happened"], json!([])); // told once
    }

    #[test]
    fn a_role_waits_for_another_roles_action() {
        let mut m = spec_machine("
            WRITER   = !draft -> reviewed -> WRITER
            REVIEWER = !review -> reviewed -> REVIEWER
            MAIN     = WRITER || REVIEWER");
        m.act("writer", "draft", &Value::Null).unwrap();
        assert!(m.waiting("writer").unwrap()); // reviewed needs the reviewer
        m.act("reviewer", "review", &Value::Null).unwrap();
        assert!(!m.waiting("writer").unwrap());
        assert_eq!(m.catch_up("writer").unwrap()["happened"], json!(["reviewed"]));
    }

    #[test]
    fn a_stopping_agent_is_told_once_that_its_machine_ended() {
        let mut m = machine();
        m.set(Status::Deadlocked, "the spec can do nothing more");
        let daemon = Daemon { machines: Mutex::new([("demo".to_string(), m)].into()), cel: Mutex::new(None) };
        let stop = || respond(Request::Stop { machine: "demo".into(), role: "writer".into() }, &daemon).unwrap();
        let first = stop();
        assert_eq!(first["ended"], json!("deadlocked"));
        assert!(first["reason"].as_str().unwrap().contains("nothing more"));
        assert!(stop().get("ended").is_none()); // told once; after that it may stop
    }

    #[test]
    fn specs_with_inputs_are_refused() {
        let contract = csp::parse("NOTION = ?page_deleted -> NOTION\nWRITER = !draft -> WRITER\nMAIN = NOTION || WRITER").unwrap();
        let e = no_inputs(&contract).unwrap_err().to_string();
        assert!(e.contains("?page_deleted") && e.contains("doesn't observe the world"), "{e}");
        assert!(no_inputs(&csp::parse(SPEC).unwrap()).is_ok());
    }

    #[test]
    fn harness_tool_names_are_matched_to_services() {
        assert_eq!(service_tool("mcp__notion__notion-update-page", "notion"), Some("notion-update-page"));
        assert_eq!(service_tool("mcp__plugin_acme_notion__notion-fetch", "notion"), Some("notion-fetch"));
        assert_eq!(service_tool("mcp__claude_ai_Notion__notion-fetch", "claude.ai Notion"), Some("notion-fetch"));
        assert_eq!(service_tool("mcp__notionx__notion-fetch", "notion"), None);
        assert_eq!(service_tool("mcp__plugin_acme_notionx__notion-fetch", "notion"), None);
        assert_eq!(service_tool("Bash", "notion"), None);

        let mut m = machine();
        m.routes.push(UnitRoutes { server: "notion".into(), translator: None, hidden: vec!["notion-fetch".into()] });
        assert!(matches!(m.route("mcp__notion__notion-fetch"), Route::Hidden));
        assert!(matches!(m.route("mcp__notion__notion-delete"), Route::Unoffered(s, t) if s == "notion" && t == "notion-delete"));
        assert!(matches!(m.route("mcp__github__create_issue"), Route::Unknown));
    }

    #[test]
    fn internal_events_alone_forever_diverge() {
        let mut m = spec_machine("P = tick -> P");
        m.advance();
        assert!(m.status == Status::Diverged);
    }

    #[test]
    fn actions_are_checked() {
        let mut m = machine();
        assert!(m.act("writer", "recreate", &Value::Null).is_err()); // not yet
        assert!(m.act("writer", "filed", &Value::Null).is_err()); // internal, not submitted
        assert!(m.act("reviewer", "draft", &Value::Null).is_err()); // no such role
        assert!(m.act("archive", "draft", &Value::Null).is_err()); // not something archive does
        assert!(m.act("writer", "draft", &Value::Null).is_ok());
        assert!(m.act("writer", "draft", &Value::Null).is_err()); // once, until it recreates
        assert!(m.act("writer", "recreate", &Value::Null).is_ok());
        assert!(m.status == Status::Running);
    }
}
