//! `complier hook`: Claude Code runs this for PreToolUse and PostToolUse.
//! PreToolUse asks the daemon whether the tool is offered and denies it if
//! not; PostToolUse advances the contract once the tool has actually run.
//! Repos without a contract are left alone. If a contract exists but the
//! daemon cannot be reached, PreToolUse fails closed for the tools it names.

use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

use crate::{csp, daemon, launchd, paths};

pub fn run() -> i32 {
    let mut buf = String::new();
    let _ = std::io::stdin().read_to_string(&mut buf);
    let event: Value = serde_json::from_str(&buf).unwrap_or(Value::Null);

    let name = event["hook_event_name"].as_str().unwrap_or("");
    let tool = event["tool_name"].as_str().unwrap_or("");
    let session = event["session_id"].as_str().filter(|s| !s.is_empty()).unwrap_or("default");
    let cwd = event["cwd"]
        .as_str()
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_default();

    let Some(contract) = paths::find_contract(&cwd) else { return 0 };
    // Tools the contract never mentions are not ours to judge, even when the
    // daemon is down. A contract that fails to parse constrains everything.
    if let Ok(c) = std::fs::read_to_string(&contract).map_err(|e| e.to_string()).and_then(|s| csp::parse(&s)) {
        if !c.alphabet.contains(tool) {
            return 0;
        }
    }
    let op = match name {
        "PreToolUse" => "check",
        "PostToolUse" => "record",
        _ => return 0,
    };
    let req = json!({
        "op": op,
        "contract": contract.to_string_lossy(),
        "session": session,
        "tool": tool,
    });

    let resp = match ask(&req) {
        Ok(r) => r,
        Err(e) => {
            if op == "check" {
                deny(&format!(
                    "complier: the daemon is not running ({e}), so the contract cannot be checked. \
                     Run `complier init` or `complier daemon`."
                ));
            } else {
                eprintln!("complier: could not record {tool}: {e}");
            }
            return 0;
        }
    };

    if op == "check" && resp["allowed"] == json!(false) {
        let reason = match resp["reason"].as_str() {
            Some(r) => format!("complier: {r}"),
            None => {
                let offered: Vec<&str> = resp["offered"]
                    .as_array()
                    .map(|a| a.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                format!(
                    "complier: the contract does not allow {tool} here. Current state: {}. Allowed next: {}.",
                    resp["state"].as_str().unwrap_or("?"),
                    if offered.is_empty() { "nothing".to_string() } else { offered.join(", ") },
                )
            }
        };
        deny(&reason);
    }
    0
}

/// Asks the daemon, starting it through launchd once if it is down.
fn ask(req: &Value) -> std::io::Result<Value> {
    match daemon::request(req) {
        Ok(r) => Ok(r),
        Err(_) => {
            launchd::kickstart();
            let mut last = None;
            for _ in 0..10 {
                std::thread::sleep(Duration::from_millis(200));
                match daemon::request(req) {
                    Ok(r) => return Ok(r),
                    Err(e) => last = Some(e),
                }
            }
            Err(last.unwrap())
        }
    }
}

fn deny(reason: &str) {
    let out = json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    });
    println!("{out}");
}
