// The complier daemon: owns running machines, each a spec instance whose state advances on the
// input events its units' polls produce. Clients talk to it over a Unix socket, one JSON request
// and one JSON response per line.

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
}

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Status {
    Running,
    // The spec terminated (SKIP).
    Finished,
    // The spec can do nothing more and cannot terminate (STOP).
    Deadlocked,
    // The world did something the spec says can't happen: a refused input event.
    Diverged,
    // A poll failed, so the machine can no longer see the world.
    Desynced,
    Stopped,
}

struct Machine {
    spec: PathBuf,
    contract: Contract,
    state: Vec<Term>,
    status: Status,
    stop: Arc<AtomicBool>,
    log: File,
}

impl Machine {
    // Input events can't be refused, only observed: one outside the alphabet is ignored (fail
    // open), and one the spec refuses means the spec no longer matches the world.
    fn input(&mut self, event: &Event) {
        if self.status != Status::Running {
            return;
        }
        let shown = poller::show(event);
        if !self.contract.alphabet.contains(&event.channel) {
            return self.record(json!({ "kind": "input", "event": shown, "outcome": "ignored" }));
        }
        let next = self.contract.after(&self.state, &event.channel);
        if next.is_empty() {
            self.record(json!({ "kind": "input", "event": shown, "outcome": "refused" }));
            return self.set(Status::Diverged, &format!("the spec refused input {shown}"));
        }
        self.state = next;
        let state = csp::show_state(&self.state);
        self.record(json!({ "kind": "input", "event": shown, "outcome": "accepted", "state": state }));
        if self.contract.initials(&self.state).is_empty() {
            match self.contract.can_finish(&self.state) {
                true => self.set(Status::Finished, "the spec terminated"),
                false => self.set(Status::Deadlocked, "the spec can do nothing more"),
            }
        }
    }

    fn set(&mut self, status: Status, reason: &str) {
        self.status = status.clone();
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
                    json!({
                        "name": name,
                        "status": m.status,
                        "state": csp::show_state(&m.state),
                        "spec": m.spec,
                    })
                })
                .collect())
        }
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
    let state = contract.initial();
    let mut machine = Machine { spec: spec.to_path_buf(), contract, state, status: Status::Running, stop: stop.clone(), log };
    machine.record(json!({ "kind": "status", "status": Status::Running, "reason": "machine up", "state": csp::show_state(&machine.state) }));
    all.insert(name.clone(), machine);

    for unit in units {
        let (machines, name, stop) = (machines.clone(), name.clone(), stop.clone());
        std::thread::spawn(move || {
            let result = poller::poll(&unit, &stop, |event| {
                if let Some(machine) = machines.lock().unwrap().get_mut(&name) {
                    machine.input(&event);
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

// Sends one request to the daemon, starting it in the background first if it isn't running.
pub fn request(request: &Request) -> Result<Value> {
    let path = socket()?;
    let stream = match UnixStream::connect(&path) {
        Ok(stream) => stream,
        Err(_) => start_background(&path)?,
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
