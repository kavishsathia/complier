// The agent harnesses complier's hooks run in: Claude Code and Codex. What complier enforces (the
// spec, its units, the daemon's verdicts) is the same in both; what differs is how each harness
// names its tools, what its hook payloads carry and which hook answers it honours. This module is
// that difference, kept in one place, so the hooks and the daemon stay harness-neutral.
//
// Claude Code (the plugin's hooks/hooks.json, `complier hook <event>`):
//   - built-in tools are the service `claude-code`; MCP tools are `mcp__<server>__<tool>`, with the
//     tool's own name;
//   - a failed call is reported (PostToolUseFailure, PermissionDenied), and a Bash result carries its
//     stdout;
//   - PreToolUse can answer `ask`, so the user confirms a command.
//
// Codex (the plugin's hooks/codex.json, `complier hook --harness codex <event>`), as checked against
// the Codex CLI 0.163.0 and its source:
//   - built-in tools are the service `codex`: shell commands arrive as `Bash` (tool_input.command),
//     file edits as `apply_patch` (the patch text in tool_input.command), other local tools by name;
//     MCP tools are `mcp__<server>__<tool>` with every character but letters, digits and `_` in the
//     server and tool names replaced by `_`;
//   - PostToolUse runs only for calls that produced output: a call that errors (a patch that doesn't
//     apply, a declined approval, another hook's denial) reports nothing, and a Bash result is only
//     the command's output, without its exit status;
//   - PreToolUse denies with permissionDecision "deny" (or exit 2); "ask" and continue:false are not
//     supported there and let the call run, so complier never sends them;
//   - hooks run only once the user has reviewed and trusted them (/hooks); an untrusted hook is
//     skipped, which would leave the agent unconstrained, so complier checks trust before it binds a
//     Codex session or starts a Codex agent.

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Harness {
    Claude,
    Codex,
}

impl Default for Harness {
    fn default() -> Self {
        Harness::Claude
    }
}

impl std::fmt::Display for Harness {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.id())
    }
}

impl std::str::FromStr for Harness {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "claude" | "claude-code" => Ok(Harness::Claude),
            "codex" => Ok(Harness::Codex),
            other => bail!("unknown harness {other:?}: use claude or codex"),
        }
    }
}

impl Harness {
    pub const ALL: [Harness; 2] = [Harness::Claude, Harness::Codex];

    pub fn id(self) -> &'static str {
        match self {
            Harness::Claude => "claude",
            Harness::Codex => "codex",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Harness::Claude => "Claude Code",
            Harness::Codex => "Codex",
        }
    }

    // The service a unit names to translate this harness's own (built-in) tools.
    pub fn builtin_service(self) -> &'static str {
        match self {
            Harness::Claude => "claude-code",
            Harness::Codex => "codex",
        }
    }

    pub fn of_builtin_service(service: &str) -> Option<Harness> {
        Harness::ALL.into_iter().find(|h| h.builtin_service() == service)
    }

    // The environment variable through which the harness tells the commands it runs which session
    // they run in (the same id its hooks get as session_id).
    pub fn session_env(self) -> &'static str {
        match self {
            Harness::Claude => "CLAUDE_CODE_SESSION_ID",
            Harness::Codex => "CODEX_SESSION_ID",
        }
    }

    // Whether every call that doesn't succeed is reported to a hook. Where it isn't, a call still in
    // flight when the agent's turn ends is counted as failed (see daemon.rs, Stop).
    pub fn reports_failures(self) -> bool {
        matches!(self, Harness::Claude)
    }

    // Whether PreToolUse can ask the user to confirm a call.
    pub fn can_ask(self) -> bool {
        matches!(self, Harness::Claude)
    }

    // Whether hooks run only after the user has trusted them, and must be checked before relying on
    // them.
    pub fn hooks_need_trust(self) -> bool {
        matches!(self, Harness::Codex)
    }

    // The program that starts an agent in this harness.
    pub fn program(self) -> &'static str {
        match self {
            Harness::Claude => "claude",
            Harness::Codex => "codex",
        }
    }

    // The harness's name for a tool's MCP server or tool, as it writes them into tool names.
    pub fn tool_name_part(self, name: &str) -> String {
        match self {
            // Anything but letters, digits, `_` and `-` becomes `_`.
            Harness::Claude => name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect(),
            // Anything but letters, digits and `_` becomes `_` (Codex's sanitize_responses_api_tool_name).
            Harness::Codex => name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect(),
        }
    }

    // Files a built-in tool call would write: Some(paths) for an editing tool, None otherwise.
    pub fn edited_paths(self, tool: &str, args: &Value) -> Option<Vec<String>> {
        match (self, tool) {
            (Harness::Claude, "Write" | "Edit" | "MultiEdit" | "NotebookEdit") => {
                Some(vec![args["file_path"].as_str().or(args["notebook_path"].as_str()).unwrap_or_default().to_string()])
            }
            (Harness::Codex, "apply_patch") => Some(patch_paths(args["command"].as_str().unwrap_or_default())),
            _ => None,
        }
    }

    // Paths that configure what constrains an agent in this harness.
    fn protected_parts(self) -> &'static [&'static str] {
        match self {
            Harness::Claude => &[".claude/settings", ".claude.json", ".mcp.json", "/.complier/"],
            Harness::Codex => &[".codex/", "/.complier/", "hooks.json", ".codex-plugin/"],
        }
    }

    // Shell command fragments that touch what constrains an agent. Best effort only: the sandbox's
    // write and socket restrictions are what make this hold.
    fn protected_commands(self) -> &'static [&'static str] {
        match self {
            Harness::Claude => &[
                "complier machine", "complier workflow", "complier hook", "complier add", "complier remove", ".complier/", "daemon.sock",
                ".claude/settings", ".claude.json", ".mcp.json",
            ],
            Harness::Codex => &[
                "complier machine", "complier workflow", "complier hook", "complier add", "complier remove", ".complier/", "daemon.sock",
                ".codex/", "codex features", "codex plugin", "codex mcp", "codex exec", "codex app-server", "--disable hooks",
                "--disable codex_hooks", "features.hooks", "features.codex_hooks", "dangerously-bypass-hook-trust", "CODEX_HOME",
            ],
        }
    }

    pub fn protected_path(self, path: &str) -> bool {
        let plugin = plugin_root_env();
        self.protected_parts().iter().any(|p| path.contains(p)) || (!plugin.is_empty() && path.starts_with(&plugin))
    }

    // Why a built-in tool call may not run inside a machine because it would edit what enforces it.
    pub fn protection(self, tool: &str, args: &Value) -> Option<String> {
        if let Some(paths) = self.edited_paths(tool, args) {
            return paths
                .into_iter()
                .find(|p| self.protected_path(p))
                .map(|path| format!("{path} configures what constrains you, so it can't be edited from inside a machine."));
        }
        if tool == "Bash" {
            let command = args["command"].as_str().unwrap_or_default();
            return self
                .protected_commands()
                .iter()
                .find(|needle| command.contains(*needle))
                .map(|needle| format!("this command touches {needle}, which configures what constrains you."));
        }
        None
    }

    // A call's outcome as its PostToolUse (or PostToolUseFailure, PermissionDenied) hook reports it:
    // (ok, output, error). For a Codex Bash call complier wrapped (see wrap_command), `ok` comes from
    // the exit status the daemon reads out of the output; here it is provisionally true.
    pub fn outcome(self, input: &Value) -> (bool, String, String) {
        let event = input["hook_event_name"].as_str().unwrap_or_default();
        let response = &input["tool_response"];
        match self {
            Harness::Claude => {
                let ok = event == "PostToolUse";
                let output = match response["stdout"].as_str() {
                    Some(stdout) => stdout.to_string(),
                    None if response.is_null() => String::new(),
                    None => response.as_str().map(String::from).unwrap_or_else(|| response.to_string()),
                };
                let error = match event {
                    "PermissionDenied" => "permission denied".to_string(),
                    _ => input["error"].as_str().unwrap_or_default().to_string(),
                };
                (ok, output, error)
            }
            Harness::Codex => {
                let tool = input["tool_name"].as_str().unwrap_or_default();
                if let Some(text) = response.as_str() {
                    // apply_patch reports "Exit code: N" first; Bash's status is in complier's marker.
                    if tool == "apply_patch" {
                        let code = text.lines().next().and_then(|l| l.strip_prefix("Exit code: ")).and_then(|c| c.trim().parse::<i32>().ok());
                        let ok = code.is_none_or(|c| c == 0);
                        return (ok, text.to_string(), if ok { String::new() } else { text.to_string() });
                    }
                    return (true, text.to_string(), String::new());
                }
                if response.is_null() {
                    return (true, String::new(), String::new());
                }
                // An MCP call's result (CallToolResult): failed if isError.
                let failed = response["isError"] == true;
                let text: Vec<&str> = response["content"].as_array().into_iter().flatten().filter_map(|c| c["text"].as_str()).collect();
                let output = if text.is_empty() { response.to_string() } else { text.join("\n") };
                (!failed, output.clone(), if failed { output } else { String::new() })
            }
        }
    }

    // The PreToolUse answer that denies a call.
    pub fn deny(self, reason: &str) -> Value {
        // Codex quotes the reason as "...hook: {reason}. Tool: ...", so it ends without a full stop.
        let reason = if self == Harness::Codex { reason.trim_end_matches('.') } else { reason };
        json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason } })
    }
}

// The plugin's own folder, which an agent must not edit: Claude Code sets CLAUDE_PLUGIN_ROOT, Codex
// sets PLUGIN_ROOT (and CLAUDE_PLUGIN_ROOT too, for compatibility).
fn plugin_root_env() -> String {
    std::env::var("PLUGIN_ROOT").or_else(|_| std::env::var("CLAUDE_PLUGIN_ROOT")).unwrap_or_default()
}

// The files a Codex patch adds, updates, deletes or moves to.
pub fn patch_paths(patch: &str) -> Vec<String> {
    let heads = ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "];
    patch
        .lines()
        .filter_map(|line| heads.iter().find_map(|h| line.trim_start().strip_prefix(h)).map(|p| p.trim().to_string()))
        .collect()
}

// Codex's PostToolUse for a shell command carries only the command's output, not its exit status, so
// a failed test run would look like a passing one. complier therefore runs each Bash call it allowed
// and translated with an exit trap that prints the status, tagged with a nonce the daemon keeps for
// that call, as the command's last line. The daemon reads the status back from the output (and
// strips the line); a command whose output has no such line (it replaced the trap, or was killed)
// counts as failed.
pub fn wrap_command(command: &str, nonce: &str) -> String {
    format!("trap 'printf \"\\n[complier {nonce} exit %s]\\n\" \"$?\"' EXIT\n{command}")
}

// The exit status a wrapped command printed (its last such line), and its output without that line.
pub fn exit_status(output: &str, nonce: &str) -> (Option<i32>, String) {
    let tag = format!("[complier {nonce} exit ");
    let Some(at) = output.rfind(&tag) else { return (None, output.to_string()) };
    let rest = &output[at + tag.len()..];
    let Some(end) = rest.find(']') else { return (None, output.to_string()) };
    let status = rest[..end].trim().parse::<i32>().ok();
    let before = output[..at].strip_suffix('\n').unwrap_or(&output[..at]);
    let after = rest[end + 1..].strip_prefix('\n').unwrap_or(&rest[end + 1..]);
    (status, format!("{before}{after}"))
}

// A fresh nonce for one call.
pub fn nonce(tool_use_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
    let digest = Sha256::digest(format!("{}:{now}:{tool_use_id}:{:p}", std::process::id(), &now).as_bytes());
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

// The hook commands complier's Codex hooks file registers, by Codex hook event.
pub const CODEX_HOOKS: [(&str, &str); 4] = [
    ("sessionStart", "complier hook --harness codex session-start"),
    ("preToolUse", "complier hook --harness codex pre-tool-use"),
    ("postToolUse", "complier hook --harness codex post-tool-use"),
    ("stop", "complier hook --harness codex stop"),
];

// What Codex says about complier's hooks for a folder: for each hook complier needs, whether Codex
// will run it there (enabled, and trusted or managed). Asks the Codex CLI itself, through its
// app-server's hooks/list (the list the /hooks browser shows).
pub struct CodexHooks {
    pub missing: Vec<&'static str>,
    pub untrusted: Vec<(&'static str, String)>,
    pub codex: String,
}

impl CodexHooks {
    pub fn ready(&self) -> bool {
        self.missing.is_empty() && self.untrusted.is_empty()
    }

    pub fn explain(&self, dir: &Path) -> String {
        let mut out = Vec::new();
        if !self.missing.is_empty() {
            out.push(format!(
                "Codex has no complier hook for {} in {}. Install complier's Codex plugin: `codex plugin marketplace add kavishsathia/complier` (or the path of a complier checkout), then `codex plugin add complier@complier`.",
                self.missing.join(", "),
                dir.display()
            ));
        }
        if !self.untrusted.is_empty() {
            let which: Vec<String> = self.untrusted.iter().map(|(e, s)| format!("{e} ({s})")).collect();
            out.push(format!(
                "Codex hasn't been told to trust complier's hooks for {}, so it would skip them and nothing would be enforced. Start `codex` in {}, open /hooks, review complier's hooks and trust them, then try again.",
                which.join(", "),
                dir.display()
            ));
        }
        out.join(" ")
    }
}

pub fn codex_hooks(dir: &Path) -> Result<CodexHooks> {
    let mut child = Command::new(Harness::Codex.program())
        .arg("app-server")
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("couldn't start `codex app-server` to ask Codex about its hooks (is Codex installed and on PATH?)")?;
    let mut stdin = child.stdin.take().context("codex app-server's stdin")?;
    let stdout = child.stdout.take().context("codex app-server's stdout")?;
    let dir_text = dir.to_string_lossy().to_string();
    let requests = [
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "clientInfo": { "name": "complier", "version": env!("CARGO_PKG_VERSION") } } }),
        json!({ "jsonrpc": "2.0", "method": "initialized" }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "hooks/list", "params": { "cwds": [dir_text] } }),
    ];
    for r in &requests {
        writeln!(stdin, "{r}")?;
    }
    stdin.flush()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut codex = String::new();
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            if msg["id"] == 1 {
                codex = msg["result"]["userAgent"].as_str().unwrap_or_default().to_string();
            }
            if msg["id"] == 2 {
                let _ = tx.send((codex.clone(), msg));
                break;
            }
        }
    });
    let answer = rx.recv_timeout(std::time::Duration::from_secs(30));
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    let (codex, msg) = answer.map_err(|_| anyhow::anyhow!("Codex's app-server didn't answer hooks/list"))?;
    if let Some(e) = msg.get("error") {
        bail!("Codex's hooks/list failed: {e}");
    }
    let hooks: Vec<&Value> = msg["result"]["data"].as_array().into_iter().flatten().flat_map(|entry| entry["hooks"].as_array().into_iter().flatten()).collect();
    Ok(check_codex_hooks(&hooks, codex))
}

// Which of complier's hooks are missing or wouldn't run, from hooks/list's entries.
pub fn check_codex_hooks(hooks: &[&Value], codex: String) -> CodexHooks {
    let mut missing = Vec::new();
    let mut untrusted = Vec::new();
    for (event, command) in CODEX_HOOKS {
        let ours: Vec<&&Value> = hooks.iter().filter(|h| h["eventName"] == event && h["command"].as_str().is_some_and(|c| c.contains(command))).collect();
        if ours.is_empty() {
            missing.push(event);
        } else if !ours.iter().any(|h| h["enabled"] == true && (h["trustStatus"] == "trusted" || h["trustStatus"] == "managed")) {
            let status = ours.iter().map(|h| if h["enabled"] == true { h["trustStatus"].as_str().unwrap_or("?").to_string() } else { "disabled".into() }).collect::<Vec<_>>().join("/");
            untrusted.push((event, status));
        }
    }
    CodexHooks { missing, untrusted, codex }
}

// A session whose complier hooks have run: written by the session-start hook, so that applying a
// workflow can tell a session complier's hooks actually run in from one where the harness would
// skip them (Codex, until the user trusts them).
pub fn live_dir() -> Result<PathBuf> {
    Ok(crate::daemon::dir()?.join("sessions").join("live"))
}

pub fn mark_live(session: &str, harness: Harness) {
    if !crate::workflow::valid_id(session) {
        return;
    }
    let Ok(dir) = live_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    let at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let _ = std::fs::write(dir.join(format!("{session}.json")), json!({ "harness": harness, "at": at }).to_string());
}

pub fn live(session: &str) -> Option<Harness> {
    if !crate::workflow::valid_id(session) {
        return None;
    }
    let text = std::fs::read_to_string(live_dir().ok()?.join(format!("{session}.json"))).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    serde_json::from_value(v["harness"].clone()).ok()
}

// The command that starts an agent of `harness` in `machine` as `role` with `prompt`: the shared
// launch configuration the workflow launcher and the demos' launch.json use (`complier agent`).
pub fn agent_command(harness: Harness, plugin: &Path, prompt: Option<&str>, extra: &[String]) -> Vec<String> {
    let mut cmd = vec![harness.program().to_string()];
    match harness {
        Harness::Claude => {
            cmd.push("--plugin-dir".into());
            cmd.push(plugin.display().to_string());
        }
        // Codex loads complier's hooks and skill from its installed plugin (checked before starting).
        Harness::Codex => {}
    }
    cmd.extend(extra.iter().cloned());
    if let Some(p) = prompt.filter(|p| !p.is_empty()) {
        cmd.push(p.to_string());
    }
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harnesses_parse_and_name_their_builtin_services() {
        assert_eq!("codex".parse::<Harness>().unwrap(), Harness::Codex);
        assert_eq!("Claude-Code".parse::<Harness>().unwrap(), Harness::Claude);
        assert!("cursor".parse::<Harness>().is_err());
        assert_eq!(Harness::of_builtin_service("codex"), Some(Harness::Codex));
        assert_eq!(Harness::of_builtin_service("notion"), None);
        assert_eq!(Harness::Codex.tool_name_part("write-item"), "write_item");
        assert_eq!(Harness::Claude.tool_name_part("write-item"), "write-item");
        assert_eq!(Harness::Claude.tool_name_part("claude.ai Notion"), "claude_ai_Notion");
    }

    #[test]
    fn codex_patches_are_checked_for_protected_files() {
        let patch = "*** Begin Patch\n*** Add File: notes.md\n+x\n*** Update File: .codex/hooks.json\n@@\n-a\n+b\n*** End Patch\n";
        assert_eq!(patch_paths(patch), ["notes.md", ".codex/hooks.json"]);
        let args = json!({ "command": patch });
        assert!(Harness::Codex.protection("apply_patch", &args).unwrap().contains(".codex/hooks.json"));
        let fine = json!({ "command": "*** Begin Patch\n*** Add File: src/a.rs\n+x\n*** End Patch\n" });
        assert_eq!(Harness::Codex.protection("apply_patch", &fine), None);
        assert!(Harness::Codex.protection("Bash", &json!({ "command": "codex exec --disable hooks 'do it'" })).is_some());
        assert!(Harness::Codex.protection("Bash", &json!({ "command": "cat ~/.complier/sessions/x.json" })).is_some());
        assert_eq!(Harness::Codex.protection("Bash", &json!({ "command": "cargo test" })), None);
        // Claude's checks are as they were.
        assert!(Harness::Claude.protection("Edit", &json!({ "file_path": "/p/.claude/settings.json" })).is_some());
        assert_eq!(Harness::Claude.protection("apply_patch", &args), None);
    }

    #[test]
    fn a_wrapped_commands_exit_status_is_read_back_and_its_line_removed() {
        let wrapped = wrap_command("cargo test", "abc123");
        assert!(wrapped.starts_with("trap '") && wrapped.ends_with("\ncargo test"));
        assert_eq!(exit_status("ok\n\n[complier abc123 exit 0]\n", "abc123"), (Some(0), "ok\n".to_string()));
        assert_eq!(exit_status("boom\n\n[complier abc123 exit 101]\n", "abc123"), (Some(101), "boom\n".to_string()));
        // A forged line with another nonce doesn't count, and no line at all is no status.
        assert_eq!(exit_status("[complier ffff exit 0]\n", "abc123").0, None);
        assert_eq!(exit_status("plain output", "abc123"), (None, "plain output".to_string()));
        // The last tagged line is the trap's.
        assert_eq!(exit_status("[complier abc123 exit 0]\nmore\n\n[complier abc123 exit 2]\n", "abc123").0, Some(2));
    }

    #[test]
    fn outcomes_are_read_from_each_harness_payload() {
        // Captured from Codex 0.163.0.
        let mcp = json!({ "hook_event_name": "PostToolUse", "tool_name": "mcp__fake__write_item", "tool_response": { "content": [{ "type": "text", "text": "did write-item" }] } });
        assert_eq!(Harness::Codex.outcome(&mcp), (true, "did write-item".into(), String::new()));
        let mcp_err = json!({ "hook_event_name": "PostToolUse", "tool_response": { "content": [{ "type": "text", "text": "nope" }], "isError": true } });
        assert!(!Harness::Codex.outcome(&mcp_err).0);
        let patch = json!({ "hook_event_name": "PostToolUse", "tool_name": "apply_patch", "tool_response": "Exit code: 0\nWall time: 0.1 seconds\nOutput:\nSuccess." });
        assert!(Harness::Codex.outcome(&patch).0);
        let bash = json!({ "hook_event_name": "PostToolUse", "tool_name": "Bash", "tool_response": "out\nerr\n" });
        assert_eq!(Harness::Codex.outcome(&bash), (true, "out\nerr\n".into(), String::new()));
        // Claude Code's, as before.
        let failed = json!({ "hook_event_name": "PostToolUseFailure", "error": "exit 1", "tool_response": { "stdout": "x" } });
        assert_eq!(Harness::Claude.outcome(&failed), (false, "x".into(), "exit 1".into()));
    }

    #[test]
    fn hooks_list_entries_say_whether_complier_hooks_would_run() {
        let entry = |event: &str, cmd: &str, trust: &str, enabled: bool| json!({ "eventName": event, "command": cmd, "trustStatus": trust, "enabled": enabled });
        let all: Vec<Value> = CODEX_HOOKS.iter().map(|(e, c)| entry(e, c, "trusted", true)).collect();
        assert!(check_codex_hooks(&all.iter().collect::<Vec<_>>(), String::new()).ready());
        let mut some = all.clone();
        some[1] = entry("preToolUse", "complier hook --harness codex pre-tool-use", "untrusted", true);
        some[3] = entry("stop", "complier hook --harness codex stop", "trusted", false);
        some.remove(0);
        let check = check_codex_hooks(&some.iter().collect::<Vec<_>>(), String::new());
        assert_eq!(check.missing, ["sessionStart"]);
        assert_eq!(check.untrusted, [("preToolUse", "untrusted".to_string()), ("stop", "disabled".to_string())]);
        // Someone else's hook with a similar name isn't complier's.
        let other = [entry("preToolUse", "my-hook complier", "trusted", true)];
        assert_eq!(check_codex_hooks(&other.iter().collect::<Vec<_>>(), String::new()).missing.len(), 4);
    }
}
