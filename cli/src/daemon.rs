//! The per-user daemon. Hook processes are short-lived, so the contract state
//! for every (contract, session) pair lives here, behind a Unix socket that
//! speaks one JSON request and one JSON response per connection.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};

use crate::csp::{self, Contract, Term};
use crate::paths;

struct Loaded {
    mtime: SystemTime,
    contract: Result<Arc<Contract>, String>,
}

struct Session {
    state: Vec<Term>,
    trace: Vec<String>,
}

#[derive(Default)]
struct Server {
    contracts: HashMap<String, Loaded>,
    sessions: HashMap<(String, String), Session>,
}

impl Server {
    /// Parses the contract, or reuses it if the file has not changed. An
    /// edited contract starts every session on it over from the top.
    fn load(&mut self, path: &str) -> Result<Arc<Contract>, String> {
        let mtime = std::fs::metadata(path)
            .and_then(|m| m.modified())
            .map_err(|e| format!("cannot read {path}: {e}"))?;
        if let Some(l) = self.contracts.get(path) {
            if l.mtime == mtime {
                return l.contract.clone();
            }
        }
        let contract = std::fs::read_to_string(path)
            .map_err(|e| e.to_string())
            .and_then(|src| csp::parse(&src))
            .map(Arc::new);
        self.sessions.retain(|(c, _), _| c != path);
        self.contracts.insert(path.to_string(), Loaded { mtime, contract: contract.clone() });
        contract
    }

    fn handle(&mut self, req: &Value) -> Value {
        let op = req["op"].as_str().unwrap_or("");
        let path = req["contract"].as_str().unwrap_or("").to_string();
        let session = req["session"].as_str().unwrap_or("default").to_string();
        let tool = req["tool"].as_str().unwrap_or("");

        match op {
            "ping" => json!({ "ok": true }),
            "status" => self.status(),
            "reset" => {
                self.sessions.retain(|(c, _), _| *c != path);
                json!({ "ok": true })
            }
            "check" | "record" => {
                let contract = match self.load(&path) {
                    Ok(c) => c,
                    Err(e) => {
                        return json!({ "ok": true, "allowed": false, "reason": format!("contract error: {e}") })
                    }
                };
                if !contract.alphabet.contains(tool) {
                    return json!({ "ok": true, "allowed": true, "constrained": false });
                }
                let s = self
                    .sessions
                    .entry((path, session))
                    .or_insert_with(|| Session { state: contract.initial(), trace: Vec::new() });
                let offered: Vec<String> = contract.initials(&s.state).into_iter().collect();
                let allowed = offered.iter().any(|e| e == tool);
                if op == "record" {
                    let next = contract.after(&s.state, tool);
                    if next.is_empty() {
                        s.trace.push(format!("{tool} (ran outside the contract)"));
                    } else {
                        s.state = next;
                        s.trace.push(tool.to_string());
                    }
                }
                json!({
                    "ok": true,
                    "allowed": allowed,
                    "constrained": true,
                    "state": csp::show_state(&s.state),
                    "offered": offered,
                })
            }
            _ => json!({ "ok": false, "reason": format!("unknown op {op:?}") }),
        }
    }

    fn status(&self) -> Value {
        let sessions: Vec<Value> = self
            .sessions
            .iter()
            .map(|((contract, session), s)| {
                json!({
                    "contract": contract,
                    "session": session,
                    "state": csp::show_state(&s.state),
                    "trace": s.trace,
                })
            })
            .collect();
        json!({ "ok": true, "sessions": sessions })
    }
}

pub fn serve() -> i32 {
    let sock = paths::socket();
    if let Some(dir) = sock.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if UnixStream::connect(&sock).is_ok() {
        eprintln!("complier: daemon already running at {}", sock.display());
        return 0;
    }
    let _ = std::fs::remove_file(&sock);
    let listener = match UnixListener::bind(&sock) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("complier: cannot listen on {}: {e}", sock.display());
            return 1;
        }
    };
    eprintln!("complier: daemon listening on {}", sock.display());

    let server = Arc::new(Mutex::new(Server::default()));
    for stream in listener.incoming().flatten() {
        let server = Arc::clone(&server);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(&stream);
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                return;
            }
            let resp = match serde_json::from_str::<Value>(&line) {
                Ok(req) => server.lock().unwrap().handle(&req),
                Err(e) => json!({ "ok": false, "reason": format!("bad request: {e}") }),
            };
            let _ = writeln!(&stream, "{resp}");
        });
    }
    0
}

pub fn request(req: &Value) -> std::io::Result<Value> {
    let mut stream = UnixStream::connect(paths::socket())?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    writeln!(stream, "{req}")?;
    let mut line = String::new();
    BufReader::new(&stream).read_line(&mut line)?;
    serde_json::from_str(&line).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

pub fn status() -> i32 {
    let resp = match request(&json!({ "op": "status" })) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("complier: daemon is not reachable at {}: {e}", paths::socket().display());
            return 1;
        }
    };
    println!("daemon: running at {}", paths::socket().display());
    let sessions = resp["sessions"].as_array().cloned().unwrap_or_default();
    if sessions.is_empty() {
        println!("no sessions yet");
    }
    for s in sessions {
        println!();
        println!("session  {}", s["session"].as_str().unwrap_or(""));
        println!("contract {}", s["contract"].as_str().unwrap_or(""));
        println!("state    {}", s["state"].as_str().unwrap_or(""));
        let trace: Vec<&str> = s["trace"].as_array().map(|t| t.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        println!("trace    {}", if trace.is_empty() { "(empty)".to_string() } else { trace.join(", ") });
    }
    0
}

pub fn reset() -> i32 {
    let root = match paths::repo_root() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("complier: {e}");
            return 1;
        }
    };
    let contract = root.join(paths::CONTRACT);
    match request(&json!({ "op": "reset", "contract": contract.to_string_lossy() })) {
        Ok(_) => {
            println!("complier: sessions on {} start over", contract.display());
            0
        }
        Err(e) => {
            eprintln!("complier: daemon is not reachable: {e}");
            1
        }
    }
}
