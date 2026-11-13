// Claude Code hooks for an agent bound to a machine by COMPLIER_MACHINE and COMPLIER_ROLE, or by
// applying a saved workflow to its session (workflow.rs). Outside a machine the hooks only ask the
// user before a workflow is saved or applied, and tell the agent which workflows are saved. Inside one, the pre-tool-use hook is where complier
// enforces the spec: every MCP tool call is sent to the daemon, which translates it with the
// machine's units and allows it only if the spec does; anything else about it fails closed.

use crate::daemon::{self, Request};
use crate::workflow;
use anyhow::Result;
use serde_json::{json, Value};
use std::io::Read;

// The machine and role the agent acts in: from COMPLIER_MACHINE and COMPLIER_ROLE, else from the
// workflow applied to its session. A workflow whose policy has finished lets the session go here.
pub fn binding(input: &Value) -> Option<(String, String)> {
    if let (Ok(machine), Ok(role)) = (std::env::var("COMPLIER_MACHINE"), std::env::var("COMPLIER_ROLE")) {
        return Some((machine, role));
    }
    let (path, bound) = workflow::bound(input["session_id"].as_str()?)?;
    let info = daemon::request(&Request::MachineInfo { machine: bound.machine.clone(), role: bound.role.clone() }, false);
    if info.is_ok_and(|info| info["status"] == "finished") {
        workflow::finish(&path, &bound);
        return None;
    }
    Some((bound.machine, bound.role))
}

pub fn input() -> Value {
    let mut text = String::new();
    let _ = std::io::stdin().read_to_string(&mut text);
    serde_json::from_str(&text).unwrap_or(Value::Null)
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect()
}

// Tells the agent which machine and role it's in, and what its spec lets it do.
pub fn session_start() -> Result<()> {
    let input = input();
    let Some((machine, role)) = binding(&input) else { return saved_workflows() };
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

// Inside a machine: a tool call runs only if the daemon allows it, and nothing may edit what
// enforces that. Every call goes to the daemon: MCP tools always, built-in tools when the machine has
// a unit for them (the daemon lets them through otherwise). A call the daemon allows gets no answer
// from the hook, so the harness's own permission rules still apply to it; one it refuses, or can't
// decide, is denied with the reason.
pub fn pre_tool_use() -> Result<()> {
    let input = input();
    let Some((machine, role)) = binding(&input) else { return consent(&input) };
    let tool = input["tool_name"].as_str().unwrap_or_default();
    let args = &input["tool_input"];
    let tool_use_id = input["tool_use_id"].as_str().unwrap_or_default().to_string();
    let reason = protection(tool, args).or_else(|| {
        let request = Request::Call { machine: machine.clone(), role, tool: tool.to_string(), arguments: args.clone(), tool_use_id };
        match daemon::request(&request, false) {
            Ok(decision) if decision["allow"] == true => None,
            Ok(decision) => Some(decision["reason"].as_str().unwrap_or("the daemon refused this call").to_string()),
            Err(e) => Some(format!("couldn't check this call with machine {machine}, so it can't run: {e:#}")),
        }
    });
    if let Some(reason) = reason {
        let reason = format!("complier: {reason}");
        println!(
            "{}",
            json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason } })
        );
    }
    Ok(())
}

// After a call: PostToolUse (it succeeded), PostToolUseFailure (it failed) or PermissionDenied (it
// never ran). The result goes to the daemon, which binds it if the machine is waiting for this call.
// The call has already happened, so nothing here can block it.
pub fn post_tool_use() -> Result<()> {
    let input = input();
    let Some((machine, role)) = binding(&input) else { return Ok(()) };
    let ok = input["hook_event_name"] == "PostToolUse";
    let response = &input["tool_response"];
    let output = match response["stdout"].as_str() {
        Some(stdout) => stdout.to_string(),
        None if response.is_null() => String::new(),
        None => response.as_str().map(String::from).unwrap_or_else(|| response.to_string()),
    };
    let error = match input["hook_event_name"].as_str() {
        Some("PermissionDenied") => "permission denied".to_string(),
        _ => input["error"].as_str().unwrap_or_default().to_string(),
    };
    let request = Request::Result {
        machine,
        role,
        tool_use_id: input["tool_use_id"].as_str().unwrap_or_default().to_string(),
        ok,
        output,
        error,
        value: None,
    };
    if let Err(e) = daemon::request(&request, false) {
        eprintln!("complier: {e:#}");
    }
    Ok(())
}

// Edits to what enforces complier are blocked before anything else is asked.
fn protection(tool: &str, args: &Value) -> Option<String> {
    if ["Write", "Edit", "MultiEdit", "NotebookEdit"].contains(&tool) {
        let path = args["file_path"].as_str().or(args["notebook_path"].as_str()).unwrap_or_default();
        protected(path).then(|| format!("{path} configures what constrains you, so it can't be edited from inside a machine."))
    } else if tool == "Bash" {
        // Best effort only: the sandbox's write and socket restrictions are what make this hold.
        let command = args["command"].as_str().unwrap_or_default();
        ["complier machine", "complier workflow", "complier hook", "complier add", "complier remove", ".complier/", "daemon.sock", ".claude/settings", ".claude.json", ".mcp.json"]
            .iter()
            .find(|needle| command.contains(*needle))
            .map(|needle| format!("this command touches {needle}, which configures what constrains you."))
    } else {
        None
    }
}

fn protected(path: &str) -> bool {
    let plugin = std::env::var("CLAUDE_PLUGIN_ROOT").unwrap_or_default();
    [".claude/settings", ".claude.json", ".mcp.json", "/.complier/"].iter().any(|p| path.contains(p))
        || (!plugin.is_empty() && path.starts_with(&plugin))
}

// Outside a machine: saving, applying or removing a workflow is the user's decision, so Claude Code
// asks them to confirm the command whatever its permission rules would have done.
fn consent(input: &Value) -> Result<()> {
    if input["tool_name"] != "Bash" {
        return Ok(());
    }
    let command = input["tool_input"]["command"].as_str().unwrap_or_default();
    let asks = [
        ("complier workflow save", "saving a complier workflow"),
        ("complier workflow apply", "applying a complier workflow to this session, which then constrains its tool calls"),
        ("complier workflow rm", "deleting a saved complier workflow"),
    ];
    if let Some((_, what)) = asks.iter().find(|(needle, _)| command.contains(needle)) {
        let reason = format!("complier: {what} needs your go-ahead.");
        println!("{}", json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "ask", "permissionDecisionReason": reason } }));
    }
    Ok(())
}

// Outside a machine: names the workflows saved on this computer, so the agent can offer one when a
// request matches it. Says nothing when none are saved.
fn saved_workflows() -> Result<()> {
    let saved = workflow::list().unwrap_or_default();
    if saved.is_empty() {
        return Ok(());
    }
    let names: Vec<String> = saved.iter().map(|(name, about)| format!("{name} ({})", about.description)).collect();
    let context = format!(
        "complier workflows saved on this computer: {}. If the user asks for work one of them covers, offer to apply it (complier workflow apply <name>); apply it only if they say yes.",
        names.join("; ")
    );
    println!("{}", json!({ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": context } }));
    Ok(())
}
