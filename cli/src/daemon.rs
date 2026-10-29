// The complier daemon: owns running machines. A machine is a spec's policy W as FDR compiled it
// (fdr.rs: FDR proves the policy, then normal(Policy) comes back as an explicit automaton), plus the
// spec's translation units. complier never interprets CSP: it only follows the automaton's edges.
//
// An agent's harness sends each MCP tool call here before running it (`call`). The daemon
// translates it with the units into an action x and has the agent in role r attempt it, as
// ControllableCHAOS does against Monitor(W) under prioritise:
// - if W's current state offers attempt.r.x, W takes it and answers with its own allow.r.x or
//   deny.r.x edge (FDR proved there is exactly one); the machine moves along both;
// - otherwise the attempt is refused, and W stays where it was (refuse interleaves with W).
// Only an allowed call may run. Nothing else moves a machine: complier doesn't observe the world.
// An agent's Stop hook waits while its role has nothing it would be allowed to do, then tells it
// what other roles did meanwhile.
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
    // An agent in `role` attempts the action `event` directly, as its hook would after translating
    // a call (its value only goes in the log).
    Act {
        machine: String,
        role: String,
        event: String,
        #[serde(default)]
        value: Value,
    },
    // An agent in `role` is stopping: wait while there's nothing it would be allowed to do, then
    // report what other roles did since it last stopped.
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
    Stopped,
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
    roles: Vec<String>,
    acts: Vec<String>,
    status: Status,
    log: File,
    // Every allowed action, shown with its value, and the role that took it.
    history: Vec<(String, String)>,
    // How much of the history each role has been told about.
    told: BTreeMap<String, usize>,
    // Why the machine left Running, and which roles have been told.
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
            None => Route::Unknown,
        }
    }

    fn role(&self, role: &str) -> Result<()> {
        match self.roles.iter().any(|r| r == role) {
            true => Ok(()),
            false => bail!("the spec has no role {role} (its Role is {})", self.roles.join(", ")),
        }
    }

    fn edges(&self) -> &BTreeMap<String, usize> {
        &self.automaton.edges[self.state]
    }

    // The actions the role would be allowed to take now: attempts W offers and would allow.
    fn next(&self, role: &str) -> Vec<String> {
        let prefix = format!("attempt.{role}.");
        self.edges()
            .iter()
            .filter_map(|(event, &after)| {
                let x = event.strip_prefix(&prefix)?;
                self.automaton.edges[after].contains_key(&format!("allow.{role}.{x}")).then(|| x.to_string())
            })
            .collect()
    }

    fn show(&self) -> String {
        match self.automaton.labels.get(self.state).filter(|l| !l.is_empty()) {
            Some(label) => label.clone(),
            None => format!("state {}", self.state),
        }
    }

    // The agent in `role` attempts `x`. Err only if the machine can't take attempts at all.
    fn act(&mut self, role: &str, x: &str, value: &Value) -> Result<Verdict> {
        let shown = match value {
            Value::Null => x.to_string(),
            Value::String(v) => format!("{x}.{v}"),
            v => format!("{x}.{v}"),
        };
        if self.status != Status::Running {
            bail!("the machine is {} ({})", serde_json::to_value(&self.status)?.as_str().unwrap_or("?"), self.ended);
        }
        self.role(role)?;
        let attempt = format!("attempt.{role}.{x}");
        let verdict = if !self.acts.iter().any(|a| a == x) {
            Verdict::Refused(format!("{x} isn't an action of the spec (its Act doesn't list it)"))
        } else {
            match self.edges().get(&attempt).copied() {
                None => Verdict::Refused(format!("the policy doesn't take {x} from {role} now")),
                Some(taken) => {
                    let answers = &self.automaton.edges[taken];
                    match (answers.get(&format!("allow.{role}.{x}")), answers.get(&format!("deny.{role}.{x}"))) {
                        (Some(&next), None) => {
                            self.state = next;
                            Verdict::Allowed
                        }
                        (None, Some(&next)) => {
                            self.state = next;
                            Verdict::Denied
                        }
                        _ => bail!("FDR's automaton gives {attempt} no single verdict (state {taken}); this policy shouldn't have been admitted"),
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
        if verdict == Verdict::Allowed {
            self.history.push((shown, role.to_string()));
        }
        self.check_end();
        Ok(verdict)
    }

    // What other roles were allowed to do since the role was last told, and what it may do now.
    fn catch_up(&mut self, role: &str) -> Result<Value> {
        self.role(role)?;
        let told = self.told.get(role).copied().unwrap_or_default();
        let happened: Vec<String> = self.history[told..].iter().filter(|(_, by)| by != role).map(|(e, by)| format!("{by}: {e}")).collect();
        let report = json!({ "happened": happened, "next": self.next(role) });
        self.told.insert(role.to_string(), self.history.len());
        Ok(report)
    }

    // Whether the role has nothing it would be allowed to do, while another role still might.
    fn waiting(&self, role: &str) -> Result<bool> {
        self.role(role)?;
        Ok(self.status == Status::Running && self.next(role).is_empty())
    }

    // Ends the machine once the policy can take no more attempts: finished if it terminated.
    fn check_end(&mut self) {
        if self.status != Status::Running {
            return;
        }
        let edges = self.edges();
        if edges.keys().any(|e| e.starts_with("attempt.")) {
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
            m.role(&role)?;
            Ok(json!({ "status": m.status, "units": m.units, "roles": m.roles, "next": m.next(&role) }))
        }
        Request::Act { machine, role, event, value } => {
            let mut all = machines.lock().unwrap();
            let m = all.get_mut(&machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
            let verdict = match m.act(&role, &event, &value)? {
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
// "reason"}. A translated call's action is attempted on the machine before the answer, so a call that
// is allowed has already moved the policy. Err means nothing could be decided (no such machine or
// role, or the CEL backend failed); the hook refuses the call then too.
fn call(daemon: &Daemon, machine: &str, role: &str, name: &str, args: &Value) -> Result<Value> {
    let deny = |reason: String| Ok(json!({ "allow": false, "reason": reason }));
    let route = {
        let all = daemon.machines.lock().unwrap();
        let m = all.get(machine).ok_or_else(|| anyhow!("no machine named {machine}"))?;
        m.role(role)?;
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
    match m.act(role, &event.channel, &event.value)? {
        Verdict::Allowed => Ok(json!({ "allow": true, "event": translate::show(&event) })),
        Verdict::Denied => deny(format!("the policy denied this {tool} call ({}).", event.channel)),
        Verdict::Refused(reason) => deny(format!("refused this {tool} call ({}): {reason}.", event.channel)),
    }
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
        roles: compiled.roles,
        acts: compiled.acts,
        status: Status::Running,
        log,
        history: Vec::new(),
        told: BTreeMap::new(),
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

    // normal(Policy) for: the writer drafts; publishing needs a review since the last draft;
    // anything else is denied. (What FDR compiles fdr's writer example to, written out by hand so
    // these tests don't need FDR; tests/e2e.rs runs the real thing.)
    //   0 = P(false), 5 = P(true); 1-4 and 6-9 wait for a verdict.
    fn machine() -> Machine {
        let t = [
            (0, "attempt.writer.draft", 1),
            (0, "attempt.reviewer.review", 2),
            (0, "attempt.writer.publish", 3),
            (0, "attempt.writer.other", 4),
            (1, "allow.writer.draft", 0),
            (2, "allow.reviewer.review", 5),
            (3, "deny.writer.publish", 0),
            (4, "deny.writer.other", 0),
            (5, "attempt.writer.draft", 6),
            (5, "attempt.reviewer.review", 7),
            (5, "attempt.writer.publish", 8),
            (5, "attempt.writer.other", 9),
            (6, "allow.writer.draft", 0),
            (7, "allow.reviewer.review", 5),
            (8, "allow.writer.publish", 10),
            (9, "deny.writer.other", 5),
        ];
        let mut labels = vec![String::new(); 11];
        labels[0] = "P(false)".into();
        labels[5] = "P(true)".into();
        with(Automaton::from_transitions(labels, 0, &t), &["writer", "reviewer"], &["draft", "review", "publish", "other"])
    }

    fn with(automaton: Automaton, roles: &[&str], acts: &[&str]) -> Machine {
        let log = std::env::temp_dir().join(format!("complier-test-{}.log", std::process::id()));
        Machine {
            spec: PathBuf::new(),
            units: Vec::new(),
            routes: Vec::new(),
            state: automaton.root,
            automaton,
            roles: roles.iter().map(|r| r.to_string()).collect(),
            acts: acts.iter().map(|a| a.to_string()).collect(),
            status: Status::Running,
            log: File::create(log).unwrap(),
            history: Vec::new(),
            told: BTreeMap::new(),
            ended: String::new(),
            told_ended: Default::default(),
        }
    }

    #[test]
    fn attempts_are_allowed_denied_or_refused_by_the_automaton() {
        let mut m = machine();
        // Denied: the policy takes the attempt and answers no; it moves along its deny edge.
        assert_eq!(m.act("writer", "publish", &Value::Null).unwrap(), Verdict::Denied);
        assert_eq!(m.show(), "P(false)");
        assert_eq!(m.act("reviewer", "review", &Value::Null).unwrap(), Verdict::Allowed);
        assert_eq!(m.show(), "P(true)");
        // Refused: the policy doesn't offer the attempt, and its state is kept.
        assert!(matches!(m.act("reviewer", "draft", &Value::Null).unwrap(), Verdict::Refused(r) if r.contains("doesn't take draft from reviewer")));
        assert_eq!(m.show(), "P(true)");
        assert!(matches!(m.act("writer", "delete", &Value::Null).unwrap(), Verdict::Refused(r) if r.contains("isn't an action")));
        assert_eq!(m.act("writer", "publish", &json!("p1")).unwrap(), Verdict::Allowed);
        // State 10 takes no attempts: the machine has ended, and further attempts are errors.
        assert!(m.status == Status::Deadlocked);
        assert!(m.act("writer", "draft", &Value::Null).is_err());
        assert!(m.act("editor", "draft", &Value::Null).is_err());
    }

    #[test]
    fn a_role_waits_until_it_would_be_allowed_and_hears_what_others_did() {
        let mut m = machine();
        assert_eq!(m.next("writer"), ["draft"]); // publish and other are offered but denied
        assert_eq!(m.next("reviewer"), ["review"]);
        m.act("reviewer", "review", &json!("p1")).unwrap();
        assert_eq!(m.next("writer"), ["draft", "publish"]);
        let report = m.catch_up("writer").unwrap();
        assert_eq!(report["happened"], json!(["reviewer: review.p1"]));
        assert_eq!(m.catch_up("writer").unwrap()["happened"], json!([])); // told once
        assert!(!m.waiting("writer").unwrap());
        assert!(m.catch_up("nobody").is_err());
    }

    #[test]
    fn a_policy_that_terminates_finishes() {
        let a = Automaton::from_transitions(vec![String::new(); 4], 0, &[(0, "attempt.w.go", 1), (1, "allow.w.go", 2), (2, "✓", 3)]);
        let mut m = with(a, &["w"], &["go"]);
        assert_eq!(m.act("w", "go", &Value::Null).unwrap(), Verdict::Allowed);
        assert!(m.status == Status::Finished);
    }

    #[test]
    fn a_stopping_agent_is_told_once_that_its_machine_ended() {
        let mut m = machine();
        m.set(Status::Deadlocked, "the policy takes no more attempts");
        let daemon = Daemon { machines: Mutex::new([("demo".to_string(), m)].into()), cel: Mutex::new(None) };
        let stop = || respond(Request::Stop { machine: "demo".into(), role: "writer".into() }, &daemon).unwrap();
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
        assert_eq!(service_tool("mcp__notionx__notion-fetch", "notion"), None);
        assert_eq!(service_tool("mcp__plugin_acme_notionx__notion-fetch", "notion"), None);
        assert_eq!(service_tool("Bash", "notion"), None);

        let mut m = machine();
        m.routes.push(UnitRoutes { server: "notion".into(), translator: None, hidden: vec!["notion-fetch".into()] });
        assert!(matches!(m.route("mcp__notion__notion-fetch"), Route::Hidden));
        assert!(matches!(m.route("mcp__notion__notion-delete"), Route::Unoffered(s, t) if s == "notion" && t == "notion-delete"));
        assert!(matches!(m.route("mcp__github__create_issue"), Route::Unknown));
    }
}
