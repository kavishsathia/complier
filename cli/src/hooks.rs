// Claude Code hooks for an agent bound to a machine by COMPLIER_MACHINE and COMPLIER_ROLE.
// Outside a machine every hook does nothing.

use crate::daemon::{self, Request};
use anyhow::Result;
use serde_json::{json, Value};
use std::io::Read;

fn binding() -> Option<(String, String)> {
    Some((std::env::var("COMPLIER_MACHINE").ok()?, std::env::var("COMPLIER_ROLE").ok()?))
}

fn input() -> Value {
    let mut text = String::new();
    let _ = std::io::stdin().read_to_string(&mut text);
    serde_json::from_str(&text).unwrap_or(Value::Null)
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect()
}

// Tells the agent which machine and role it's in, and what its spec lets it do.
pub fn session_start() -> Result<()> {
    input();
    let Some((machine, role)) = binding() else { return Ok(()) };
    let context = match daemon::request(&Request::MachineInfo { machine: machine.clone(), role: role.clone() }, false) {
        Ok(info) => {
            let next = strings(&info["next"]);
            format!(
                "You are role {role} in complier machine {machine} (status: {}). Tools from the complier MCP server are checked against the machine's spec: a call the spec doesn't allow now is refused, so read refusals as the protocol telling you to wait or do something else. Other MCP servers are blocked. Your spec currently lets you: {}. When you have nothing to do, finish your turn: complier holds your stop until your spec lets you do something, then tells you what happened.",
                info["status"].as_str().unwrap_or("?"),
                if next.is_empty() { "nothing yet".into() } else { next.join(", ") },
            )
        }
        Err(e) => format!("complier: can't bind you to machine {machine} as {role}: {e:#}. Every complier tool will be refused until that's fixed."),
    };
    println!("{}", json!({ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": context } }));
    Ok(())
}

// Inside a machine: only complier's MCP tools, and no edits to what enforces that.
pub fn pre_tool_use() -> Result<()> {
    let input = input();
    if binding().is_none() {
        return Ok(());
    }
    let tool = input["tool_name"].as_str().unwrap_or_default();
    let args = &input["tool_input"];
    let reason = if tool.starts_with("mcp__") && !tool.starts_with("mcp__plugin_complier_") {
        Some(format!("{tool} reaches an MCP server directly; inside a complier machine only complier's tools are allowed."))
    } else if ["Write", "Edit", "MultiEdit", "NotebookEdit"].contains(&tool) {
        let path = args["file_path"].as_str().or(args["notebook_path"].as_str()).unwrap_or_default();
        protected(path).then(|| format!("{path} configures what constrains you, so it can't be edited from inside a machine."))
    } else if tool == "Bash" {
        // Best effort only: the sandbox's write and socket restrictions are what make this hold.
        let command = args["command"].as_str().unwrap_or_default();
        ["complier machine", "complier hook", "complier proxy", "complier add", "complier remove", ".complier/", "daemon.sock", ".claude/settings", ".claude.json", ".mcp.json"]
            .iter()
            .find(|needle| command.contains(*needle))
            .map(|needle| format!("this command touches {needle}, which configures what constrains you."))
    } else {
        None
    };
    if let Some(reason) = reason {
        let reason = format!("complier: {reason}");
        println!(
            "{}",
            json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason } })
        );
    }
    Ok(())
}

fn protected(path: &str) -> bool {
    let plugin = std::env::var("CLAUDE_PLUGIN_ROOT").unwrap_or_default();
    [".claude/settings", ".claude.json", ".mcp.json", "/.complier/"].iter().any(|p| path.contains(p))
        || (!plugin.is_empty() && path.starts_with(&plugin))
}
