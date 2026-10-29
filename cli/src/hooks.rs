// Claude Code hooks for an agent bound to a machine by COMPLIER_MACHINE and COMPLIER_ROLE.
// Outside a machine every hook does nothing. Inside one, the pre-tool-use hook is where complier
// enforces the spec: every MCP tool call is sent to the daemon, which translates it with the
// machine's units and allows it only if the spec does; anything else about it fails closed.

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
                "You are role {role} in complier machine {machine} (status: {}). Every MCP tool call you make is checked against the machine's spec before it runs: a call the spec doesn't allow now is refused, so read refusals as the protocol telling you to wait or do something else. MCP tools the machine's units don't name are blocked. Your spec currently lets you: {}. When you have nothing to do, finish your turn: complier holds your stop until your spec lets you do something, then tells you what happened.",
                info["status"].as_str().unwrap_or("?"),
                if next.is_empty() { "nothing yet".into() } else { next.join(", ") },
            )
        }
        Err(e) => format!("complier: can't bind you to machine {machine} as {role}: {e:#}. Every complier tool will be refused until that's fixed."),
    };
    println!("{}", json!({ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": context } }));
    Ok(())
}

// Inside a machine: an MCP tool call runs only if the daemon allows it, and nothing may edit what
// enforces that. A call the daemon allows gets no answer from the hook, so the harness's own
// permission rules still apply to it; one it refuses, or can't decide, is denied with the reason.
pub fn pre_tool_use() -> Result<()> {
    let input = input();
    let Some((machine, role)) = binding() else { return Ok(()) };
    let tool = input["tool_name"].as_str().unwrap_or_default();
    let args = &input["tool_input"];
    let reason = if tool.starts_with("mcp__") {
        let request = Request::Call { machine: machine.clone(), role, tool: tool.to_string(), arguments: args.clone() };
        match daemon::request(&request, false) {
            Ok(decision) if decision["allow"] == true => None,
            Ok(decision) => Some(decision["reason"].as_str().unwrap_or("the daemon refused this call").to_string()),
            Err(e) => Some(format!("couldn't check this call with machine {machine}, so it can't run: {e:#}")),
        }
    } else if ["Write", "Edit", "MultiEdit", "NotebookEdit"].contains(&tool) {
        let path = args["file_path"].as_str().or(args["notebook_path"].as_str()).unwrap_or_default();
        protected(path).then(|| format!("{path} configures what constrains you, so it can't be edited from inside a machine."))
    } else if tool == "Bash" {
        // Best effort only: the sandbox's write and socket restrictions are what make this hold.
        let command = args["command"].as_str().unwrap_or_default();
        ["complier machine", "complier hook", "complier add", "complier remove", ".complier/", "daemon.sock", ".claude/settings", ".claude.json", ".mcp.json"]
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
