// The complier daemon: owns running machines, each a spec instance (a || composition of
// components) whose state advances on three kinds of event:
// - world events, from its units' polls: performed when every component sharing them can;
// - actions, performed by an agent through its role's component;
// - deliveries, events an agent's component receives (`e?`), performed by its Stop hook.
// Clients talk to it over a Unix socket, one JSON request and one JSON response per line.

use crate::csp::{self, Contract, Term};
use crate::host::Event;
use crate::poller;
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
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
    // A machine's units and roles, for a proxy binding an agent to it.
    MachineInfo { machine: String, role: String },
    // An agent in `role` performs `event` (its value only goes in the log).
    Act {
        machine: String,
        role: String,
        event: String,
        #[serde(default)]
        value: Value,
    },
    // An agent in `role` is stopping: deliver what it can receive, waiting while it waits to receive.
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
    // A poll failed, so the machine can no longer see the world.
    Desynced,
    Stopped,
}

struct Machine {
    spec: PathBuf,
    units: Vec<PathBuf>,
    contract: Contract,
    // One state per component, in the order of contract.components.
    states: Vec<Vec<Term>>,
    status: Status,
    stop: Arc<AtomicBool>,
    log: File,
    // World events performed so far, and how many of them each role has been told about.
    world: Vec<String>,
    told: BTreeMap<String, usize>,
    // Why the machine left Running, and which roles have been told.
    ended: String,
    told_ended: std::collections::BTreeSet<String>,
}

impl Machine {
    fn participants(&self, event: &str) -> Vec<usize> {
        (0..self.states.len()).filter(|&i| self.contract.components[i].alphabet.contains(event)).collect()
    }

    // An event happens only when every component that shares it can take part.
    fn enabled(&self, event: &str) -> bool {
        let parts = self.participants(event);
        !parts.is_empty() && parts.iter().all(|&i| self.contract.initials(&self.states[i]).contains(event))
    }

    fn perform(&mut self, event: &str) {
        for i in self.participants(event) {
            self.states[i] = self.contract.after(&self.states[i], event);
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

    // The world can't be refused, only observed, so input fails open: an event outside the
    // alphabet is ignored, and one the spec refuses right now is dropped. Either way the state
    // doesn't move and the log keeps a record.
    fn world(&mut self, event: &Event) {
        if self.status != Status::Running {
            return;
        }
        let shown = poller::show(event);
        if !self.contract.alphabet.contains(&event.channel) {
            return self.record(json!({ "kind": "world", "event": shown, "outcome": "ignored" }));
        }
        if !self.enabled(&event.channel) {
            return self.record(json!({ "kind": "world", "event": shown, "outcome": "dropped", "reason": "the spec doesn't allow it now" }));
        }
        self.perform(&event.channel);
        self.world.push(shown.clone());
        self.record(json!({ "kind": "world", "event": shown, "outcome": "accepted", "state": self.show() }));
        self.check_end();
    }

    // Agent actions are controllable, so a refused one is just refused (fail closed).
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
        } else if component.receives.contains(event) {
            Err(format!("{event} is delivered to role {role}, not performed by it"))
        } else if !self.enabled(event) {
            Err(format!("the spec doesn't allow {event} now"))
        } else {
            Ok(())
        };
        if let Err(reason) = outcome {
            self.record(json!({ "kind": "act", "role": role, "event": shown, "outcome": "refused", "reason": reason }));
            bail!("{reason}");
        }
        self.perform(event);
        self.record(json!({ "kind": "act", "role": role, "event": shown, "outcome": "accepted", "state": self.show() }));
        self.check_end();
        Ok(())
    }

    // Performs every delivery the role can receive now. None means there's nothing yet; the
    // caller decides whether to wait, using `waiting`.
    fn deliver(&mut self, role: &str) -> Result<Value> {
        let i = self.component(role)?;
        let mut delivered = Vec::new();
        while self.status == Status::Running {
            let receives = &self.contract.components[i].receives;
            let ready = self.contract.initials(&self.states[i]).into_iter().find(|e| receives.contains(e) && self.enabled(e));
            let Some(event) = ready else { break };
            self.perform(&event);
            self.record(json!({ "kind": "deliver", "role": role, "event": event, "state": self.show() }));
            delivered.push(event);
            self.check_end();
        }
        let told = self.told.entry(role.to_string()).or_insert(0);
        let world = if delivered.is_empty() { vec![] } else { self.world[*told..].to_vec() };
        if !delivered.is_empty() {
            *told = self.world.len();
        }
        let receives = &self.contract.components[i].receives;
        let next: Vec<String> = self.contract.initials(&self.states[i]).into_iter().filter(|e| !receives.contains(e)).collect();
        Ok(json!({ "delivered": delivered, "world": world, "next": next }))
    }

    // Whether the role's process is waiting to receive something.
    fn waiting(&self, role: &str) -> Result<bool> {
        let i = self.component(role)?;
        let receives = &self.contract.components[i].receives;
        Ok(self.status == Status::Running && self.contract.initials(&self.states[i]).iter().any(|e| receives.contains(e)))
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
        if status != Status::Running {
            self.stop.store(true, Ordering::Relaxed);
        }
        self.record(json!({ "kind": "status", "status": status, "reason": reason }));
    }

    fn record(&mut self, mut entry: Value) {
        entry["t"] = json!(SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64);
        let _ = writeln!(self.log, "{entry}");
    }
}

type Machines = Arc<Mutex<BTreeMap<String, Machine>>>;

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

    let machines: Machines = Arc::default();
    for stream in listener.incoming() {
        let machines = machines.clone();
        std::thread::spawn(move || {
            if let Err(e) = handle(stream?, &machines) {
                eprintln!("client error: {e:#}");
            }
            anyhow::Ok(())
        });
    }
    Ok(())
}

fn handle(stream: UnixStream, machines: &Machines) -> Result<()> {
    let mut line = String::new();
    BufReader::new(&stream).read_line(&mut line)?;
    let response = match serde_json::from_str::<Request>(&line) {
        Ok(request) => match respond(request, machines) {
            Ok(value) => json!({ "ok": value }),
            Err(e) => json!({ "error": format!("{e:#}") }),
        },
        Err(e) => json!({ "error": format!("bad request: {e}") }),
    };
    writeln!(&stream, "{response}")?;
    Ok(())
}

fn respond(request: Request, machines: &Machines) -> Result<Value> {
    match request {
        Request::Ping => Ok(json!("pong")),
        Request::MachineUp { name, spec, units } => machine_up(machines, name, &spec, units),
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
            let receives = &m.contract.components[i].receives;
            let next: Vec<String> = m.contract.initials(&m.states[i]).into_iter().filter(|e| !receives.contains(e)).collect();
            Ok(json!({ "status": m.status, "units": m.units, "next": next, "receives": receives }))
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
                let Some(m) = all.get_mut(&machine) else { return Ok(json!({ "delivered": [], "note": format!("no machine named {machine}") })) };
                // Tell each role once that its machine is no longer running, so it can tell its user.
                if m.status != Status::Running && m.status != Status::Finished && m.told_ended.insert(role.clone()) {
                    return Ok(json!({ "delivered": [], "ended": m.status, "reason": m.ended }));
                }
                let delivery = m.deliver(&role)?;
                if delivery["delivered"].as_array().is_some_and(|d| !d.is_empty()) || !m.waiting(&role)? {
                    return Ok(delivery);
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        },
    }
}

fn machine_up(machines: &Machines, name: String, spec: &Path, units: Vec<PathBuf>) -> Result<Value> {
    let source = std::fs::read_to_string(spec).with_context(|| format!("reading {}", spec.display()))?;
    let contract = csp::parse(&source).map_err(|e| anyhow!("{}: {e}", spec.display()))?;
    let mut all = machines.lock().unwrap();
    if all.contains_key(&name) {
        bail!("a machine named {name} is already running");
    }

    let log = OpenOptions::new().create(true).append(true).open(log_path(&name)?)?;
    let stop = Arc::new(AtomicBool::new(false));
    let states = contract.initial_states();
    let mut machine = Machine {
        spec: spec.to_path_buf(),
        units: units.clone(),
        contract,
        states,
        status: Status::Running,
        stop: stop.clone(),
        log,
        world: Vec::new(),
        told: BTreeMap::new(),
        ended: String::new(),
        told_ended: Default::default(),
    };
    machine.record(json!({ "kind": "status", "status": Status::Running, "reason": "machine up", "state": machine.show() }));
    all.insert(name.clone(), machine);

    for unit in units {
        let (machines, name, stop) = (machines.clone(), name.clone(), stop.clone());
        std::thread::spawn(move || {
            let result = poller::poll(&unit, &stop, |event| {
                if let Some(machine) = machines.lock().unwrap().get_mut(&name) {
                    machine.world(&event);
                }
            });
            if let Err(e) = result {
                if let Some(machine) = machines.lock().unwrap().get_mut(&name) {
                    machine.set(Status::Desynced, &format!("{}: {e:#}", unit.display()));
                }
            }
        });
    }
    println!("machine {name} up");
    Ok(json!(name))
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

    // The world deletes pages; a size-1 inbox buffers each deletion until the writer, busy
    // drafting, stops and has it delivered.
    const SPEC: &str = "
        NOTION = page_deleted -> NOTION
        INBOX  = page_deleted -> deleted -> INBOX
        WRITER = draft -> deleted? -> recreate -> WRITER
        MAIN   = NOTION || INBOX || WRITER";

    fn machine() -> Machine {
        let contract = csp::parse(SPEC).unwrap();
        let log = std::env::temp_dir().join(format!("complier-test-{}.log", std::process::id()));
        Machine {
            spec: PathBuf::new(),
            units: Vec::new(),
            states: contract.initial_states(),
            contract,
            status: Status::Running,
            stop: Arc::default(),
            log: File::create(log).unwrap(),
            world: Vec::new(),
            told: BTreeMap::new(),
            ended: String::new(),
            told_ended: Default::default(),
        }
    }

    fn deleted(id: &str) -> Event {
        serde_json::from_value(json!({ "channel": "page_deleted", "value": id })).unwrap()
    }

    #[test]
    fn world_moves_on_while_the_agent_catches_up() {
        let mut m = machine();
        m.world(&deleted("p1")); // the world doesn't wait for the writer
        assert!(m.status == Status::Running);
        assert!(m.deliver("writer").unwrap()["delivered"].as_array().unwrap().is_empty());
        assert!(!m.waiting("writer").unwrap()); // it still has to draft, so its stop isn't held

        m.act("writer", "draft", &Value::Null).unwrap();
        assert!(m.waiting("writer").unwrap());
        let d = m.deliver("writer").unwrap();
        assert_eq!(d["delivered"], json!(["deleted"]));
        assert_eq!(d["world"], json!(["page_deleted.p1"]));
        assert_eq!(d["next"], json!(["recreate"]));
    }

    #[test]
    fn a_world_event_the_spec_refuses_is_dropped() {
        let mut m = machine();
        m.world(&deleted("p1"));
        m.world(&deleted("p2")); // the inbox is full, so this one is dropped
        assert!(m.status == Status::Running);
        assert_eq!(m.world, ["page_deleted.p1"]);
        m.act("writer", "draft", &Value::Null).unwrap();
        assert_eq!(m.deliver("writer").unwrap()["delivered"], json!(["deleted"]));
    }

    #[test]
    fn a_stopping_agent_is_told_once_that_its_machine_ended() {
        let mut m = machine();
        m.set(Status::Desynced, "notion-fetch failed");
        let machines: Machines = Arc::new(Mutex::new([("demo".to_string(), m)].into()));
        let stop = || respond(Request::Stop { machine: "demo".into(), role: "writer".into() }, &machines).unwrap();
        let first = stop();
        assert_eq!(first["ended"], json!("desynced"));
        assert!(first["reason"].as_str().unwrap().contains("notion-fetch"));
        assert!(stop().get("ended").is_none()); // told once; after that it may stop
    }

    #[test]
    fn actions_are_checked_and_deliveries_cant_be_acted() {
        let mut m = machine();
        assert!(m.act("writer", "recreate", &Value::Null).is_err()); // not yet
        assert!(m.act("writer", "deleted", &Value::Null).is_err()); // delivered, not performed
        assert!(m.act("reviewer", "draft", &Value::Null).is_err()); // no such role
        assert!(m.act("writer", "draft", &Value::Null).is_ok());
        assert!(m.status == Status::Running);
    }
}
