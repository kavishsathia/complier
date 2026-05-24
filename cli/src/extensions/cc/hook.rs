//! Claude Code hook event handlers.
//!
//! Reads one Claude Code hook event from stdin, dispatches based on
//! `hook_event_name`, talks to the daemon over the lean protocol, writes
//! the hook-shaped response to stdout. Mirrors extensions/cc/hook.py.

use std::io::{self, Read, Write};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::daemon::DaemonClient;

use super::contract;

#[derive(Deserialize, Debug, Default)]
struct HookEvent {
    #[serde(default)]
    hook_event_name: String,
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    cwd: String,
    #[serde(default)]
    tool_name: String,
    #[serde(default)]
    tool_input: Value,
    #[serde(default)]
    tool_response: Value,
}

pub fn run() -> i32 {
    let mut buf = String::new();
    if io::stdin().read_to_string(&mut buf).is_err() {
        emit(&json!({}));
        return 0;
    }
    if buf.trim().is_empty() {
        emit(&json!({}));
        return 0;
    }
    let event: HookEvent = match serde_json::from_str(&buf) {
        Ok(e) => e,
        Err(e) => {
            emit(&error_context("invalid hook event JSON", &e.to_string(), ""));
            return 0;
        }
    };

    let session_key = session_key(&event);
    let client = match DaemonClient::new(&session_key) {
        Ok(c) => c,
        Err(e) => {
            emit(&error_context(
                &format!("cc daemon unavailable: {e}"),
                "",
                &event.hook_event_name,
            ));
            return 0;
        }
    };

    // SessionStart explicitly attaches to surface the kickoff hint; other
    // events also attach to make the daemon's session lookup succeed
    // (registry.attach is idempotent on the daemon side).
    let attach_result = client.attach(&contract::resolve(&event.cwd).to_string_lossy(), None);
    let attach_hint = attach_result.as_ref().map(|h| h.hint.clone()).unwrap_or_default();

    let response = match event.hook_event_name.as_str() {
        "PreToolUse" => handle_pre_tool_use(&client, &event),
        "PostToolUse" => handle_post_tool_use(&client, &event),
        "SessionStart" => handle_session_start(attach_hint),
        _ => json!({}),
    };
    emit(&response);
    0
}

fn session_key(event: &HookEvent) -> String {
    let id = if event.session_id.is_empty() {
        "default"
    } else {
        &event.session_id
    };
    format!("cc:{id}")
}

fn handle_pre_tool_use(client: &DaemonClient, event: &HookEvent) -> Value {
    // Intercept `complier choose <arm>` Bash calls: the hook has the
    // session_id, the agent's CLI subprocess does not. We stage the choice
    // here and let Bash run the no-op binary so the agent sees a normal
    // tool result.
    if event.tool_name == "Bash" {
        if let Some(cmd) = event.tool_input.get("command").and_then(Value::as_str) {
            if let Some(arm) = parse_complier_choose(cmd) {
                return handle_choose_intercept(client, arm);
            }
        }
    }

    let tool_params = if event.tool_input.is_object() {
        event.tool_input.clone()
    } else {
        json!({})
    };
    let result = match client.check(&event.tool_name, &tool_params, None) {
        Ok(r) => r,
        Err(e) => return daemon_error_response(&format!("cc daemon error: {e}"), "PreToolUse"),
    };

    let hint_block = format_hint_block(&result.hint);

    if result.allowed {
        let mut hook_specific = json!({
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
        });
        if !hint_block.is_empty() {
            hook_specific["additionalContext"] = Value::String(hint_block);
        }
        return json!({ "hookSpecificOutput": hook_specific });
    }

    let mut parts: Vec<String> = Vec::new();
    if !result.reason.is_empty() {
        parts.push(result.reason.clone());
    }
    if !result.missing.is_empty() {
        parts.push(format!("Missing: {}", result.missing.join("; ")));
    }
    if !hint_block.is_empty() {
        parts.push(hint_block);
    }
    let deny_reason = if parts.is_empty() {
        "Blocked by complier contract.".to_string()
    } else {
        parts.join("\n\n")
    };
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": deny_reason,
        }
    })
}

fn handle_post_tool_use(client: &DaemonClient, event: &HookEvent) -> Value {
    let tool_params = if event.tool_input.is_object() {
        event.tool_input.clone()
    } else {
        json!({})
    };
    let result = match client.record(&event.tool_name, &tool_params, &event.tool_response, None) {
        Ok(r) => r,
        Err(e) => return daemon_error_response(&format!("cc daemon error: {e}"), "PostToolUse"),
    };
    let hint_block = format_hint_block(&result.hint);
    if hint_block.is_empty() {
        json!({})
    } else {
        json!({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": hint_block,
            }
        })
    }
}

fn handle_session_start(attach_hint: String) -> Value {
    let hint_block = format_hint_block(&attach_hint);
    if hint_block.is_empty() {
        return json!({});
    }
    json!({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": format!("complier contract active.\n\n{hint_block}"),
        }
    })
}

fn handle_choose_intercept(client: &DaemonClient, arm: &str) -> Value {
    let message = match client.choose(arm) {
        Ok(_) => format!("complier choice staged: {arm}"),
        Err(e) => format!("complier choose failed: {e}"),
    };
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "additionalContext": message,
        }
    })
}

fn parse_complier_choose(command: &str) -> Option<&str> {
    let trimmed = command.trim();
    let prefix = "complier choose ";
    let rest = trimmed.strip_prefix(prefix)?;
    let arm = rest.split_whitespace().next()?;
    if arm.is_empty() {
        None
    } else {
        Some(arm)
    }
}

fn format_hint_block(hint: &str) -> String {
    let trimmed = hint.trim_end();
    if trimmed.is_empty() {
        return String::new();
    }
    format!("Allowed next actions:\n{trimmed}")
}

fn daemon_error_response(message: &str, event_name: &str) -> Value {
    json!({
        "hookSpecificOutput": {
            "hookEventName": event_name,
            "additionalContext": message,
        }
    })
}

fn error_context(message: &str, _detail: &str, event_name: &str) -> Value {
    json!({
        "hookSpecificOutput": {
            "hookEventName": event_name,
            "additionalContext": message,
        }
    })
}

fn emit(payload: &Value) {
    let s = payload.to_string();
    let stdout = io::stdout();
    let mut h = stdout.lock();
    let _ = h.write_all(s.as_bytes());
    let _ = h.flush();
}
