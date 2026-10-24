// End to end, on the real binary, daemon, proxy and CEL backend, against fixtures/fake-server.mjs
// in a throwaway HOME: no credentials, nothing outside the temp directory is touched. Needs node
// (only to run the fake server, which is registered by its absolute path) and the CEL backend
// (cel/build.sh). Every complier process runs with a PATH that holds nothing, so nothing in
// loading, proving or classifying a unit can be running node.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

const BIN: &str = env!("CARGO_BIN_EXE_complier");

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

struct Env {
    home: PathBuf,
    // The fake server's directory: what it was started for and what it was called with.
    server: PathBuf,
    path: PathBuf,
    daemon: Child,
}

impl Env {
    fn new(name: &str) -> Self {
        let home = std::env::temp_dir().join(format!("complier-e2e-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let server = home.join("server");
        let path = home.join("empty-path");
        std::fs::create_dir_all(&server).unwrap();
        std::fs::create_dir_all(&path).unwrap();
        let env = |c: &mut Command| {
            c.env("HOME", &home).env("PATH", &path);
        };
        let node = String::from_utf8(Command::new("sh").args(["-c", "command -v node"]).output().unwrap().stdout).unwrap();
        let mut add = Command::new(BIN);
        env(&mut add);
        let status = add.args(["add", "fake", "--", node.trim()]).arg(fixture("fake-server.mjs")).arg(&server).status().unwrap();
        assert!(status.success());
        let mut up = Command::new(BIN);
        env(&mut up);
        let daemon = up.arg("up").stdout(Stdio::null()).spawn().unwrap();
        let socket = home.join(".complier/daemon.sock");
        let start = Instant::now();
        while !socket.exists() {
            assert!(start.elapsed() < Duration::from_secs(10), "daemon didn't start");
            std::thread::sleep(Duration::from_millis(50));
        }
        Self { home, server, path, daemon }
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

    fn calls(&self) -> Vec<Value> {
        let text = std::fs::read_to_string(self.server.join("calls.jsonl")).unwrap_or_default();
        text.lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    // How many times the fake server has been started.
    fn starts(&self) -> usize {
        std::fs::read_to_string(self.server.join("starts.log")).unwrap_or_default().lines().count()
    }

    // The daemon's child processes (the CEL backend while it proves, nothing else).
    fn daemon_children(&self) -> Vec<String> {
        let tasks = std::fs::read_dir(format!("/proc/{}/task", self.daemon.id())).unwrap();
        tasks
            .flat_map(|t| std::fs::read_to_string(t.unwrap().path().join("children")).unwrap_or_default().split_whitespace().map(String::from).collect::<Vec<_>>())
            .collect()
    }

    fn log(&self, machine: &str) -> Vec<Value> {
        let text = std::fs::read_to_string(self.home.join(format!(".complier/machines/{machine}.log"))).unwrap_or_default();
        text.lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    fn proxy(&self, machine: &str, extra: &[(&str, &str)]) -> Proxy {
        let mut c = Command::new(BIN);
        c.env("HOME", &self.home).env("PATH", &self.path).env("COMPLIER_MACHINE", machine).env("COMPLIER_ROLE", "writer");
        for (k, v) in extra {
            c.env(k, v);
        }
        let mut child = c.arg("proxy").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut proxy = Proxy { child, stdin, stdout, id: 0 };
        proxy.request("initialize", json!({ "protocolVersion": "2025-06-18" }));
        proxy
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = self.daemon.kill();
        let _ = self.daemon.wait();
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

struct Proxy {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    id: u64,
}

impl Proxy {
    fn request(&mut self, method: &str, params: Value) -> Value {
        self.id += 1;
        writeln!(self.stdin, "{}", json!({ "jsonrpc": "2.0", "id": self.id, "method": method, "params": params })).unwrap();
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        let reply: Value = serde_json::from_str(&line).unwrap();
        reply["result"].clone()
    }

    fn tools(&mut self) -> Vec<String> {
        let tools = self.request("tools/list", json!({}));
        let mut names: Vec<String> = tools["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect();
        names.sort();
        names
    }

    // (whether the call went through, the text it came back with)
    fn call(&mut self, tool: &str, args: Value) -> (bool, String) {
        let result = self.request("tools/call", json!({ "name": tool, "arguments": args }));
        (result["isError"] != true, result["content"][0]["text"].as_str().unwrap_or_default().to_string())
    }
}

impl Drop for Proxy {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn yaml_units_are_proven_and_calls_checked_with_nothing_polling() {
    let env = Env::new("main");
    // Two units over the same server: the translated writes, and a second that hides a read.
    let (ok, out) = env.machine_up("m", "writer.csp", &["fake.yaml", "reader.yaml"]);
    assert!(ok, "{out}");
    let admissions: Vec<Value> = env.log("m").into_iter().filter(|e| e["kind"] == "admission").collect();
    assert_eq!(admissions.len(), 2, "{admissions:#?}");
    let report = admissions[0]["report"].as_str().unwrap();
    assert!(report.contains("admitted: every pair") && report.contains("Z3 4.14.1"), "{report}");
    assert!(admissions[1]["report"].is_null()); // reader.yaml translates nothing

    // Nothing polls: the daemon never starts the server, and keeps no process running.
    std::thread::sleep(Duration::from_millis(1500));
    assert_eq!(env.starts(), 0);
    assert!(env.daemon_children().is_empty(), "{:?}", env.daemon_children());

    let mut proxy = env.proxy("m", &[]);
    assert_eq!(env.starts(), 1); // the proxy's one upstream session, shared by both units
    // Translated and hidden tools; not the unlisted one, or the one whose schema drifted.
    assert_eq!(proxy.tools(), ["list-items", "peek", "wipe", "write-item"]);

    let (ok, text) = proxy.call("write-item", json!({ "id": "x1" }));
    assert!(ok, "{text}");
    assert_eq!(env.calls().last().unwrap()["arguments"]["id"], "x1");

    // appended again isn't allowed now: refused by the spec, and never sent upstream.
    let (ok, text) = proxy.call("write-item", json!({ "id": "x2" }));
    assert!(!ok && text.contains("refused") && text.contains("appended"), "{text}");
    assert_eq!(env.calls().len(), 1);

    let (ok, text) = proxy.call("write-item", json!({ "id": "x2", "mode": "replace" }));
    assert!(ok, "{text}");

    // In the domain, matched by no rule: the fallback event, which this spec doesn't allow.
    let (ok, text) = proxy.call("wipe", json!({}));
    assert!(!ok && text.contains("(other)") && text.contains("isn't something role writer does"), "{text}");
    let (ok, text) = proxy.call("write-item", json!({ "id": "x3", "mode": "upsert" }));
    assert!(!ok && text.contains("(other)"), "{text}");

    // No event at all: outside the domain, or arguments of the wrong type.
    let (ok, text) = proxy.call("write-item", json!({}));
    assert!(!ok && text.contains("couldn't translate") && text.contains("outside"), "{text}");
    let (ok, text) = proxy.call("write-item", json!({ "id": 5 }));
    assert!(!ok && text.contains("id: expected a string, got a number"), "{text}");
    assert_eq!(env.calls().len(), 2);

    let (ok, text) = proxy.call("peek", json!({}));
    assert!(ok && text == "did peek", "{text}");
    let (ok, text) = proxy.call("list-items", json!({}));
    assert!(ok && text == "did list-items", "{text}");
    let (ok, text) = proxy.call("unlisted", json!({}));
    assert!(!ok && text.contains("isn't available"), "{text}");
    assert_eq!(env.calls().len(), 4);

    // The accepted actions are logged with their values, as before; nothing else moved the machine.
    let log = env.log("m");
    let acts: Vec<(String, String)> = log
        .iter()
        .filter(|e| e["kind"] == "act")
        .map(|e| (e["event"].as_str().unwrap().to_string(), e["outcome"].as_str().unwrap().to_string()))
        .collect();
    assert!(acts.contains(&("appended.x1".into(), "accepted".into())), "{acts:?}");
    assert!(acts.contains(&("replaced.x2".into(), "accepted".into())), "{acts:?}");
    assert!(acts.contains(&("other.wipe".into(), "refused".into())), "{acts:?}");
    assert!(log.iter().all(|e| ["status", "admission", "act"].contains(&e["kind"].as_str().unwrap())), "{log:#?}");
    assert_eq!(env.starts(), 1);
}

#[test]
fn the_fallback_is_allowed_only_when_the_spec_allows_it() {
    let env = Env::new("fallback");
    let (ok, out) = env.machine_up("w", "wiper.csp", &["fake.yaml"]);
    assert!(ok, "{out}");
    let mut proxy = env.proxy("w", &[]);
    let (ok, text) = proxy.call("write-item", json!({ "id": "x1" }));
    assert!(!ok && text.contains("appended isn't something role writer does"), "{text}");
    let (ok, text) = proxy.call("wipe", json!({}));
    assert!(ok, "{text}");
    assert_eq!(env.calls().last().unwrap()["name"], "wipe");
    let (ok, _) = proxy.call("wipe", json!({}));
    assert!(!ok); // once
}

#[test]
fn bad_or_unproven_units_and_input_specs_let_nothing_through() {
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

    // A spec waiting on the world would wait forever: nothing submits inputs.
    let world = dir.join("world.csp");
    std::fs::write(&world, "FEED = ?item_added -> FEED\nWRITER = !appended -> WRITER\nMAIN = FEED || WRITER\n").unwrap();
    let (ok, out) = env.machine_up("bad", world.to_str().unwrap(), &["fake.yaml"]);
    assert!(!ok && out.contains("?item_added") && out.contains("doesn't observe the world"), "{out}");
    let (_, ls) = env.complier(&["machine", "ls"]);
    assert!(!ls.contains("bad"), "{ls}");

    // A unit that breaks after machine up: the proxy offers nothing and never starts the server.
    let unit = dir.join("fake.yaml");
    std::fs::write(&unit, std::fs::read_to_string(fixture("fake.yaml")).unwrap().replace("fake/service.yaml", service.to_str().unwrap())).unwrap();
    let (ok, out) = env.machine_up("edited", "writer.csp", &[unit.to_str().unwrap()]);
    assert!(ok, "{out}");
    std::fs::write(&unit, "service: [\n").unwrap();
    let mut proxy = env.proxy("edited", &[]);
    assert!(proxy.tools().is_empty());
    let (ok, _) = proxy.call("write-item", json!({ "id": "x1" }));
    assert!(!ok);
    drop(proxy);

    // The machine is up, but this proxy can't run the CEL backend: it offers nothing.
    let (ok, out) = env.machine_up("m", "writer.csp", &["fake.yaml"]);
    assert!(ok, "{out}");
    let mut proxy = env.proxy("m", &[("COMPLIER_CEL", "/nonexistent/backend.json")]);
    assert!(proxy.tools().is_empty());
    let (ok, text) = proxy.call("write-item", json!({ "id": "x1" }));
    assert!(!ok, "{text}");
    assert!(env.calls().is_empty());
    assert_eq!(env.starts(), 0);
}

// The Notion unit, proven and exercised offline: `translate` calls nothing upstream, and with an
// empty PATH there's no node to run.
#[test]
fn the_notion_unit_is_admitted_and_tells_overwrites_from_edits() {
    let unit = Path::new(env!("CARGO_MANIFEST_DIR")).join("../units/notion.yaml");
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
    let demo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../demo/draft.yaml");
    let (ok, report) = run(&["check", demo.to_str().unwrap()]);
    assert!(ok && report.contains("draft ⊥ recreate: disjoint"), "{report}");
    let (ok, out) = run(&["translate", demo.to_str().unwrap(), "notion-create-pages", r#"{"pages": [{"properties": {"title": "A"}}, {}]}"#]);
    assert!(ok && out.trim_end().ends_with("notion-create-pages -> recreate.A, untitled"), "{out}");
}
