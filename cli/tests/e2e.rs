// End to end, on the real binary, daemon, hooks, FDR and CEL backend, in a throwaway HOME: no
// credentials, and nothing outside the temp directory is touched. Each agent tool call is sent
// through `complier hook pre-tool-use` exactly as Claude Code sends it (the hook's JSON on stdin,
// its decision on stdout). complier never contacts a service itself, so no server runs here. Needs
// the CEL backend (cel/build.sh) and complier-fdr built against a licensed FDR
// (fdr/build-complier-fdr.sh). Every complier process runs with a PATH that holds nothing, so
// nothing in loading, proving or classifying a unit can be running another program.

use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const BIN: &str = env!("CARGO_BIN_EXE_complier");

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

struct Env {
    home: PathBuf,
    path: PathBuf,
    daemon: Option<Child>,
}

impl Env {
    fn new(name: &str) -> Self {
        Self::with(name, &[])
    }

    // With extra environment for the daemon, which proves units and translates calls.
    fn with(name: &str, extra: &[(&str, &str)]) -> Self {
        let home = std::env::temp_dir().join(format!("complier-e2e-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let path = home.join("empty-path");
        std::fs::create_dir_all(&path).unwrap();
        let mut up = Command::new(BIN);
        up.env("HOME", &home).env("PATH", &path);
        for (k, v) in extra {
            up.env(k, v);
        }
        let daemon = up.arg("up").stdout(Stdio::null()).spawn().unwrap();
        let socket = home.join(".complier/daemon.sock");
        let start = Instant::now();
        while !socket.exists() {
            assert!(start.elapsed() < Duration::from_secs(10), "daemon didn't start");
            std::thread::sleep(Duration::from_millis(50));
        }
        Self { home, path, daemon: Some(daemon) }
    }

    fn complier(&self, args: &[&str]) -> (bool, String) {
        let out = Command::new(BIN).env("HOME", &self.home).env("PATH", &self.path).args(args).output().unwrap();
        (out.status.success(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
    }

    // Units and spec are fixture names or absolute paths.
    fn machine_up(&self, name: &str, spec: &str, units: &[&str]) -> (bool, String) {
        let spec = fixture(spec);
        let mut args = vec!["machine".to_string(), "up".into(), name.into(), "--spec".into(), spec.to_str().unwrap().into()];
        for unit in units {
            args.extend(["--unit".to_string(), fixture(unit).to_str().unwrap().into()]);
        }
        self.complier(&args.iter().map(String::as_str).collect::<Vec<_>>())
    }

    // The daemon's child processes (the CEL backend once a call needs it, nothing else).
    fn daemon_children(&self) -> Vec<String> {
        let pid = self.daemon.as_ref().unwrap().id().to_string();
        let out = Command::new("pgrep").args(["-P", &pid]).output().unwrap();
        String::from_utf8_lossy(&out.stdout).split_whitespace().map(String::from).collect()
    }

    fn log(&self, machine: &str) -> Vec<Value> {
        let text = std::fs::read_to_string(self.home.join(format!(".complier/machines/{machine}.log"))).unwrap_or_default();
        text.lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    // An agent in `machine` as `writer` attempts `tool` (a harness tool name): the pre-tool-use
    // hook's verdict, as (allowed, reason). An allowed call gets no output, so the harness's own
    // permissions still apply.
    fn attempt(&self, machine: &str, tool: &str, args: Value) -> (bool, String) {
        let mut child = Command::new(BIN)
            .env("HOME", &self.home)
            .env("PATH", &self.path)
            .env("COMPLIER_MACHINE", machine)
            .env("COMPLIER_ROLE", "writer")
            .args(["hook", "pre-tool-use"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let input = json!({ "hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": args });
        child.stdin.take().unwrap().write_all(input.to_string().as_bytes()).unwrap();
        let out = child.wait_with_output().unwrap();
        assert!(out.status.success(), "the hook failed: {}", String::from_utf8_lossy(&out.stderr));
        let stdout = String::from_utf8_lossy(&out.stdout);
        if stdout.trim().is_empty() {
            return (true, String::new());
        }
        let decision: Value = serde_json::from_str(&stdout).unwrap();
        let d = &decision["hookSpecificOutput"];
        assert_eq!(d["permissionDecision"], "deny", "{decision}");
        (false, d["permissionDecisionReason"].as_str().unwrap().to_string())
    }

    fn stop_daemon(&mut self) {
        if let Some(mut d) = self.daemon.take() {
            let _ = d.kill();
            let _ = d.wait();
        }
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        self.stop_daemon();
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

#[test]
fn yaml_units_are_proven_and_every_mcp_call_is_checked_by_the_hook() {
    let env = Env::new("main");
    // Two units over the same server: the translated writes, and a second that hides a read.
    let (ok, out) = env.machine_up("m", "writer.csp", &["fake.yaml", "reader.yaml"]);
    assert!(ok, "{out}");
    let log = env.log("m");
    let policy = log.iter().find(|e| e["kind"] == "policy").unwrap();
    assert!(policy["report"].as_str().unwrap().contains("admitted: FDR proved the policy"), "{policy}");
    let admissions: Vec<Value> = log.into_iter().filter(|e| e["kind"] == "admission").collect();
    assert_eq!(admissions.len(), 2, "{admissions:#?}");
    let report = admissions[0]["report"].as_str().unwrap();
    assert!(report.contains("admitted: every pair") && report.contains("Z3 4.14.1"), "{report}");
    assert!(admissions[1]["report"].is_null()); // reader.yaml translates nothing

    // Nothing polls: once the units are proven the daemon keeps no process running.
    std::thread::sleep(Duration::from_millis(1500));
    assert!(env.daemon_children().is_empty(), "{:?}", env.daemon_children());

    let (ok, text) = env.attempt("m", "mcp__fake__write-item", json!({ "id": "x1" }));
    assert!(ok, "{text}");

    // appended again isn't taken now: refused, and the policy stays where it was.
    let (ok, text) = env.attempt("m", "mcp__fake__write-item", json!({ "id": "x2" }));
    assert!(!ok && text.contains("refused") && text.contains("doesn't take appended"), "{text}");

    // A plugin's copy of the same server is the same service.
    let (ok, text) = env.attempt("m", "mcp__plugin_acme_fake__write-item", json!({ "id": "x2", "mode": "replace" }));
    assert!(ok, "{text}");

    // In the domain, matched by no rule: the fallback action, which this policy takes and denies.
    let (ok, text) = env.attempt("m", "mcp__fake__wipe", json!({}));
    assert!(!ok && text.contains("(other)") && text.contains("denied"), "{text}");
    let (ok, text) = env.attempt("m", "mcp__fake__write-item", json!({ "id": "x3", "mode": "upsert" }));
    assert!(!ok && text.contains("(other)"), "{text}");

    // No event at all: outside the domain, or arguments of the wrong type.
    let (ok, text) = env.attempt("m", "mcp__fake__write-item", json!({}));
    assert!(!ok && text.contains("couldn't translate") && text.contains("outside"), "{text}");
    let (ok, text) = env.attempt("m", "mcp__fake__write-item", json!({ "id": 5 }));
    assert!(!ok && text.contains("id: expected a string, got a number"), "{text}");

    // Hidden tools go through unchecked, from either unit.
    assert!(env.attempt("m", "mcp__fake__peek", json!({})).0);
    assert!(env.attempt("m", "mcp__fake__list-items", json!({})).0);
    // A tool of the service that no unit names, and a server no unit covers, are blocked.
    let (ok, text) = env.attempt("m", "mcp__fake__unlisted", json!({}));
    assert!(!ok && text.contains("isn't available to role writer"), "{text}");
    let (ok, text) = env.attempt("m", "mcp__github__create_issue", json!({}));
    assert!(!ok && text.contains("isn't a tool of any service"), "{text}");

    // Built-in tools aren't the daemon's business, but the config that enforces all this is off-limits.
    assert!(env.attempt("m", "Read", json!({ "file_path": "/tmp/notes.md" })).0);
    let (ok, text) = env.attempt("m", "Edit", json!({ "file_path": "/repo/.mcp.json" }));
    assert!(!ok && text.contains("configures what constrains you"), "{text}");
    let (ok, _) = env.attempt("m", "Bash", json!({ "command": "complier machine down m" }));
    assert!(!ok);

    // Every verdict is logged with the action's value; nothing else moved the machine.
    let log = env.log("m");
    let acts: Vec<(String, String)> = log
        .iter()
        .filter(|e| e["kind"] == "act")
        .map(|e| (e["event"].as_str().unwrap().to_string(), e["outcome"].as_str().unwrap().to_string()))
        .collect();
    assert!(acts.contains(&("appended.x1".into(), "allowed".into())), "{acts:?}");
    assert!(acts.contains(&("appended.x2".into(), "refused".into())), "{acts:?}");
    assert!(acts.contains(&("replaced.x2".into(), "allowed".into())), "{acts:?}");
    assert!(acts.contains(&("other.wipe".into(), "denied".into())), "{acts:?}");
    assert!(log.iter().all(|e| ["status", "policy", "admission", "act"].contains(&e["kind"].as_str().unwrap())), "{log:#?}");
}

#[test]
fn the_fallback_is_allowed_only_when_the_spec_allows_it() {
    let env = Env::new("fallback");
    let (ok, out) = env.machine_up("w", "wiper.csp", &["fake.yaml"]);
    assert!(ok, "{out}");
    let (ok, text) = env.attempt("w", "mcp__fake__write-item", json!({ "id": "x1" }));
    assert!(!ok && text.contains("doesn't take appended"), "{text}");
    let (ok, text) = env.attempt("w", "mcp__fake__wipe", json!({}));
    assert!(ok, "{text}");
    // Once: then the policy is STOP, so the machine has ended and nothing more runs.
    let (ok, text) = env.attempt("w", "mcp__fake__wipe", json!({}));
    assert!(!ok && text.contains("deadlocked"), "{text}");
}

#[test]
fn unproven_policies_bad_units_and_missing_machines_let_nothing_through() {
    let env = Env::new("refuse");
    let overlap = fixture("overlap.yaml");
    let (ok, out) = env.complier(&["check", overlap.to_str().unwrap()]);
    assert!(!ok && out.contains("append ⊥ any: OVERLAP") && out.contains("NOT admitted"), "{out}");
    let (ok, out) = env.machine_up("bad", "writer.csp", &["overlap.yaml"]);
    assert!(!ok && out.contains("isn't admitted") && out.contains("OVERLAP"), "{out}");
    let (ok, out) = env.machine_up("bad", "writer.csp", &["fake.yaml", "fake.yaml"]);
    assert!(!ok && out.contains("write-item is also offered by"), "{out}");

    // Bad YAML is refused, with where, before anything runs.
    let dir = env.home.join("units");
    std::fs::create_dir_all(&dir).unwrap();
    let service = fixture("fake/service.yaml");
    let bad = dir.join("bad.yaml");
    std::fs::write(&bad, format!("service: {}\ntranslate:\n  tools: [write-item]\n  rules:\n    a: {{ when: 'true', emit: a }}\n    a: {{ when: 'false', emit: b }}\n", service.display())).unwrap();
    let (ok, out) = env.complier(&["check", bad.to_str().unwrap()]);
    assert!(!ok && out.contains("bad.yaml:6:5: duplicate key \"a\""), "{out}");
    let (ok, out) = env.machine_up("bad", "writer.csp", &[bad.to_str().unwrap()]);
    assert!(!ok && out.contains("duplicate key"), "{out}");
    let unknown = dir.join("unknown.yaml");
    std::fs::write(&unknown, format!("service: {}\ntranslate:\n  tools: [write-item, delete-everything]\n  rules:\n    a: {{ when: 'true', emit: a }}\n", service.display())).unwrap();
    let (ok, out) = env.machine_up("bad", "writer.csp", &[unknown.to_str().unwrap()]);
    assert!(!ok && out.contains("unknown.yaml:3:23: translate.tools: delete-everything isn't a tool of fake"), "{out}");

    // FDR refuses a policy that leaves an attempt unanswered, with its counterexample...
    let (ok, out) = env.machine_up("bad", "unanswered.csp", &["fake.yaml"]);
    assert!(!ok && out.contains("isn't admitted") && out.contains("✗ every attempt the policy takes is answered"), "{out}");
    assert!(out.contains("attempt.writer.replaced"), "{out}");
    // ...one that breaks the spec's own assertion...
    let (ok, out) = env.machine_up("bad", "unsafe.csp", &["fake.yaml"]);
    assert!(!ok && out.contains("✗ the spec's own assertion") && out.contains("allow.writer.replaced"), "{out}");
    // ...and one that doesn't load.
    let broken = dir.join("broken.csp");
    std::fs::write(&broken, "datatype Role = writer\nPolicy = Permit(writer, nothing, Policy\n").unwrap();
    let (ok, out) = env.machine_up("bad", broken.to_str().unwrap(), &["fake.yaml"]);
    assert!(!ok && out.contains("isn't admitted") && out.contains("error: load"), "{out}");
    let (_, ls) = env.complier(&["machine", "ls"]);
    assert!(!ls.contains("bad"), "{ls}");

    // A unit edited after machine up changes nothing: the machine keeps the version it proved.
    let unit = dir.join("fake.yaml");
    std::fs::write(&unit, std::fs::read_to_string(fixture("fake.yaml")).unwrap().replace("fake/service.yaml", service.to_str().unwrap())).unwrap();
    let (ok, out) = env.machine_up("edited", "writer.csp", &[unit.to_str().unwrap()]);
    assert!(ok, "{out}");
    std::fs::write(&unit, "service: [\n").unwrap();
    let (ok, text) = env.attempt("edited", "mcp__fake__write-item", json!({ "id": "x1" }));
    assert!(ok, "{text}");

    // Outside a known machine, or with the daemon gone, every MCP call is refused.
    let (ok, text) = env.attempt("nowhere", "mcp__fake__peek", json!({}));
    assert!(!ok && text.contains("no machine named nowhere"), "{text}");
    let mut env = env;
    env.stop_daemon();
    let (ok, text) = env.attempt("edited", "mcp__fake__peek", json!({}));
    assert!(!ok && text.contains("daemon isn't running"), "{text}");
}

#[test]
fn without_fdr_no_machine_starts() {
    let env = Env::with("nofdr", &[("COMPLIER_FDR", "/nonexistent/backend.json")]);
    let (ok, out) = env.machine_up("m", "writer.csp", &["fake.yaml"]);
    assert!(!ok && out.contains("no FDR backend") && out.contains("cocotec.io"), "{out}");
}

#[test]
fn without_a_cel_backend_no_unit_is_admitted() {
    let env = Env::with("nocel", &[("COMPLIER_CEL", "/nonexistent/backend.json")]);
    let (ok, out) = env.machine_up("m", "writer.csp", &["fake.yaml"]);
    assert!(!ok && out.contains("no CEL backend"), "{out}");
    let (ok, text) = env.attempt("m", "mcp__fake__write-item", json!({ "id": "x1" }));
    assert!(!ok && text.contains("no machine named m"), "{text}");
}

// The Notion unit, proven and exercised offline: `translate` calls nothing upstream, and with an
// empty PATH there's no node to run.
#[test]
fn the_notion_unit_is_admitted_and_tells_overwrites_from_edits() {
    let unit = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/units/notion.yaml");
    let unit = unit.to_str().unwrap();
    let run = |args: &[&str]| {
        let out = Command::new(BIN).env("PATH", "/nonexistent").args(args).output().unwrap();
        (out.status.success(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
    };
    let (ok, report) = run(&["check", unit]);
    assert!(ok && report.contains("overwrite ⊥ edit: disjoint") && report.contains("admitted: every pair"), "{report}");
    let translate = |tool: &str, args: &str| {
        let (ok, out) = run(&["translate", unit, tool, args]);
        (ok, out.lines().last().unwrap_or_default().to_string())
    };
    let cases = [
        ("notion-create-comment", r#"{"page_id": "p1", "markdown": "hi"}"#, "commented.p1"),
        ("notion-update-page", r#"{"page_id": "p1", "command": "replace_content", "new_str": "x"}"#, "overwritten.p1"),
        ("notion-update-page", r#"{"page_id": "p1", "command": "update_content", "content_updates": []}"#, "edited.p1"),
        ("notion-update-page", r#"{"page_id": "p1", "command": "insert_content", "new_str": "x"}"#, "edited.p1"),
        ("notion-move-pages", r#"{"page_or_database_ids": ["a", "b"], "new_parent": {"page_id": "p2"}}"#, r#"moved.["a","b"]"#),
        ("notion-update-page", r#"{"page_id": "p1", "command": "rewrite_everything"}"#, "other.notion-update-page"),
    ];
    for (tool, args, event) in cases {
        assert_eq!(translate(tool, args), (true, format!("{tool} -> {event}")), "{tool} {args}");
    }
    for (tool, args, why) in [
        ("notion-update-page", r#"{"page_id": "p1"}"#, "outside the unit's domain"),
        ("notion-move-pages", r#"{"page_or_database_ids": []}"#, "outside the unit's domain"),
        ("notion-create-comment", r#"{"page_id": 7}"#, "page_id: expected a string, got a number"),
        ("notion-create-pages", r#"{"pages": []}"#, "isn't translated"),
    ] {
        let (ok, out) = translate(tool, args);
        assert!(!ok && out.contains(why), "{tool} {args}: {out}");
    }

    // The demo unit is admitted too.
    let demo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/demo/draft.yaml");
    let (ok, report) = run(&["check", demo.to_str().unwrap()]);
    assert!(ok && report.contains("draft ⊥ recreate: disjoint"), "{report}");
    let (ok, out) = run(&["translate", demo.to_str().unwrap(), "notion-create-pages", r#"{"pages": [{"properties": {"title": "A"}}, {}]}"#]);
    assert!(ok && out.trim_end().ends_with("notion-create-pages -> recreate.A, untitled"), "{out}");
}
