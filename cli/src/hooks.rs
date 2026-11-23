// The hooks of an agent harness (Claude Code or Codex, see harness.rs) for an agent bound to a
// machine by COMPLIER_MACHINE and COMPLIER_ROLE, or by applying a saved workflow to its session
// (workflow.rs). Outside a machine the hooks only ask the user before a workflow is saved or
// applied, and tell the agent which workflows are saved. Inside one, the pre-tool-use hook is where
// complier enforces the spec: every MCP tool call is sent to the daemon, which translates it with the
// machine's units and allows it only if the spec does; anything else about it fails closed.

use crate::daemon::{self, Request};
use crate::harness::{self, Harness};
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

// Tells the agent which machine and role it's in, and what its spec lets it do. In a harness whose
// hooks run only once trusted, it also records that complier's hooks run in this session.
pub fn session_start(harness: Harness) -> Result<()> {
    let input = input();
    if harness.hooks_need_trust()
        && let Some(session) = input["session_id"].as_str()
    {
        harness::mark_live(session, harness);
    }
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
// decide, is denied with the reason. In Codex, an allowed Bash call the units translated is run with
// complier's exit trap (harness::wrap_command), so its result can say whether it succeeded: that is
// the only answer given to an allowed call, and it rewrites the command without approving it.
pub fn pre_tool_use(harness: Harness) -> Result<()> {
    let input = input();
    let Some((machine, role)) = binding(&input) else { return consent(harness, &input) };
    let tool = input["tool_name"].as_str().unwrap_or_default();
    let args = &input["tool_input"];
    let tool_use_id = input["tool_use_id"].as_str().unwrap_or_default().to_string();
    let wrap = harness == Harness::Codex && tool == "Bash" && args["command"].is_string();
    let nonce = if wrap { harness::nonce(&tool_use_id) } else { String::new() };
    let mut rewrite = None;
    let reason = harness.protection(tool, args).or_else(|| {
        let request = Request::Call {
            machine: machine.clone(),
            role,
            tool: tool.to_string(),
            arguments: args.clone(),
            tool_use_id,
            harness,
            nonce: nonce.clone(),
        };
        match daemon::request(&request, false) {
            Ok(decision) if decision["allow"] == true => {
                // Translated and allowed: the machine now waits for this call's result.
                if wrap && decision["event"].is_string() {
                    rewrite = Some(harness::wrap_command(args["command"].as_str().unwrap_or_default(), &nonce));
                }
                None
            }
            Ok(decision) => Some(decision["reason"].as_str().unwrap_or("the daemon refused this call").to_string()),
            Err(e) => Some(format!("couldn't check this call with machine {machine}, so it can't run: {e:#}")),
        }
    });
    if let Some(reason) = reason {
        println!("{}", harness.deny(&format!("complier: {reason}")));
    } else if let Some(command) = rewrite {
        let mut updated = args.clone();
        updated["command"] = json!(command);
        println!("{}", json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": updated } }));
    }
    Ok(())
}

// After a call: PostToolUse (it succeeded; in Codex, it produced output), PostToolUseFailure (it
// failed) or PermissionDenied (it never ran). The result goes to the daemon, which binds it if the
// machine is waiting for this call. The call has already happened, so nothing here can block it.
pub fn post_tool_use(harness: Harness) -> Result<()> {
    let input = input();
    let Some((machine, role)) = binding(&input) else { return Ok(()) };
    let (ok, output, error) = harness.outcome(&input);
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

// Waits while the agent has nothing it may do yet; then, while the policy is still running and lets
// the agent do something, makes the agent continue instead of stopping. Outside a machine (no
// COMPLIER_MACHINE/COMPLIER_ROLE or applied workflow), or once the policy has finished, it lets the
// agent stop. In a harness that doesn't report failed calls, a call still in flight now is settled
// as failed first (daemon.rs, Stop).
pub fn stop(harness: Harness) -> Result<()> {
    let Some((machine, role)) = binding(&input()) else {
        return Ok(());
    };
    let request = Request::Stop { machine: machine.clone(), role: role.clone(), settle: !harness.reports_failures() };
    let delivery = daemon::request(&request, false)?;
    if let Some(status) = delivery["ended"].as_str() {
        let reason = format!(
            "complier: machine {machine} is {status} ({}), so nothing more will happen for you and complier will refuse your actions. Tell the user; a person has to restart the machine.",
            delivery["reason"].as_str().unwrap_or("no reason given"),
        );
        println!("{}", json!({ "decision": "block", "reason": reason }));
        return Ok(());
    }
    // The policy says when the work is done: while it is still running and lets the agent do
    // something, the agent may not stop, and is told to continue.
    let next = strings(&delivery["next"]);
    if next.is_empty() {
        return Ok(());
    }
    // Other agents' calls the policy holds until it can answer them: what this agent is acting on.
    let held: Vec<String> = delivery["held"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|h| {
            let what = h["event"].as_str().unwrap_or("?");
            match h["tool"].as_str().filter(|t| !t.is_empty()) {
                Some(tool) => {
                    let args = h["arguments"].to_string();
                    let args = if args.chars().count() > 4000 { format!("{}…", args.chars().take(4000).collect::<String>()) } else { args };
                    format!("{}'s {what} ({tool} with {args})", h["role"].as_str().unwrap_or("?"))
                }
                None => format!("{}'s {what}", h["role"].as_str().unwrap_or("?")),
            }
        })
        .collect();
    let holding = match held.as_slice() {
        [] => String::new(),
        calls => format!(" The policy is holding {} until it can answer: the call waits on what you do now.", calls.join("; ")),
    };
    let reason = format!(
        "complier: machine {machine}'s policy hasn't finished, so you're not done yet. It now lets you: {}.{holding} Continue with the workflow.",
        next.join(", ")
    );
    println!("{}", json!({ "decision": "block", "reason": reason }));
    Ok(())
}

// Outside a machine: saving, applying or removing a workflow is the user's decision. Claude Code asks
// them to confirm the command whatever its permission rules would have done. Codex can't be asked to
// (an "ask" answer would let the command run), so there the command is refused, and the agent is
// told to have the user run it in their own terminal: the user's decision either way.
fn consent(harness: Harness, input: &Value) -> Result<()> {
    if input["tool_name"] != "Bash" {
        return Ok(());
    }
    let command = input["tool_input"]["command"].as_str().unwrap_or_default();
    let asks = [
        ("complier workflow save", "saving a complier workflow"),
        ("complier workflow apply", "applying a complier workflow to this session, which then constrains its tool calls"),
        ("complier workflow rm", "deleting a saved complier workflow"),
    ];
    let Some((needle, what)) = asks.iter().find(|(needle, _)| command.contains(needle)) else { return Ok(()) };
    if harness.can_ask() {
        let reason = format!("complier: {what} needs your go-ahead.");
        println!("{}", json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "ask", "permissionDecisionReason": reason } }));
        return Ok(());
    }
    let session = input["session_id"].as_str().unwrap_or_default();
    let run = if *needle == "complier workflow apply" && !session.is_empty() && !command.contains("--session") {
        format!("{} --session {session}", command.trim())
    } else {
        command.trim().to_string()
    };
    let reason = format!(
        "complier: {what} is the user's decision, and {} can't ask them to confirm a command, so it doesn't run from here. Show the user this command and ask them to run it in their own terminal if they agree: {run}",
        harness.name()
    );
    println!("{}", harness.deny(&reason));
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
