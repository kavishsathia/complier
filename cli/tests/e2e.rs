// End to end, on the real binary, daemon, proxy and CEL backend, against fixtures/fake-server.mjs
// in a throwaway HOME: no credentials, nothing outside the temp directory is touched. Needs node
// and the CEL backend (cel/build.sh).

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
    world: PathBuf,
    daemon: Child,
}

impl Env {
    fn new(name: &str) -> Self {
        let home = std::env::temp_dir().join(format!("complier-e2e-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let world = home.join("world");
        std::fs::create_dir_all(&world).unwrap();
        std::fs::write(world.join("items.json"), "[\"a\"]").unwrap();
        let env = |c: &mut Command| {
            c.env("HOME", &home);
        };
        let mut add = Command::new(BIN);
        env(&mut add);
        let server = fixture("fake-server.mjs");
        let status = add.args(["add", "fake", "--", "node"]).arg(&server).arg(&world).status().unwrap();
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
        Self { home, world, daemon }
    }

    fn complier(&self, args: &[&str]) -> (bool, String) {
        let out = Command::new(BIN).env("HOME", &self.home).args(args).output().unwrap();
        (out.status.success(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
    }

    fn machine_up(&self, name: &str, spec: &str, unit: &str) -> (bool, String) {
        let (spec, unit) = (fixture(spec), fixture(unit));
        self.complier(&["machine", "up", name, "--spec", spec.to_str().unwrap(), "--unit", unit.to_str().unwrap()])
    }

    fn calls(&self) -> Vec<Value> {
        let text = std::fs::read_to_string(self.world.join("calls.jsonl")).unwrap_or_default();
        text.lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    fn log(&self, machine: &str) -> Vec<Value> {
        let text = std::fs::read_to_string(self.home.join(format!(".complier/machines/{machine}.log"))).unwrap_or_default();
        text.lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    fn proxy(&self, machine: &str, extra: &[(&str, &str)]) -> Proxy {
        let mut c = Command::new(BIN);
        c.env("HOME", &self.home).env("COMPLIER_MACHINE", machine).env("COMPLIER_ROLE", "writer");
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
fn calls_are_translated_proven_and_checked_and_polls_still_feed_the_world() {
    let env = Env::new("main");
    let (ok, out) = env.machine_up("m", "writer.csp", "fake.ts");
    assert!(ok, "{out}");
    let admission = env.log("m").into_iter().find(|e| e["kind"] == "admission").expect("admission logged");
    let report = admission["report"].as_str().unwrap();
    assert!(report.contains("admitted: every pair") && report.contains("Z3 4.14.1"), "{report}");

    let mut proxy = env.proxy("m", &[]);
    // Translated and hidden tools; not the unlisted one, the polled one, or the one whose schema drifted.
    assert_eq!(proxy.tools(), ["peek", "wipe", "write-item"]);

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
    assert!(!ok && text.contains("isn't available"), "{text}");

    // The accepted actions are logged with their values, as before.
    let acts: Vec<(String, String)> = env
        .log("m")
        .into_iter()
        .filter(|e| e["kind"] == "act")
        .map(|e| (e["event"].as_str().unwrap().to_string(), e["outcome"].as_str().unwrap().to_string()))
        .collect();
    assert!(acts.contains(&("appended.x1".into(), "accepted".into())), "{acts:?}");
    assert!(acts.contains(&("replaced.x2".into(), "accepted".into())), "{acts:?}");
    assert!(acts.contains(&("other.wipe".into(), "refused".into())), "{acts:?}");

    // The world adds an item; the poll's diff turns it into an input event.
    std::fs::write(env.world.join("items.json"), "[\"a\", \"b\"]").unwrap();
    let start = Instant::now();
    loop {
        let seen = env.log("m").iter().any(|e| e["kind"] == "world" && e["event"] == "item_added.b" && e["outcome"] == "accepted");
        if seen {
            break;
        }
        assert!(start.elapsed() < Duration::from_secs(15), "no world event: {:#?}", env.log("m"));
        std::thread::sleep(Duration::from_millis(200));
    }
}

#[test]
fn the_fallback_is_allowed_only_when_the_spec_allows_it() {
    let env = Env::new("fallback");
    let (ok, out) = env.machine_up("w", "wiper.csp", "fake.ts");
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
fn an_unproven_unit_or_a_missing_backend_lets_nothing_through() {
    let env = Env::new("refuse");
    let overlap = fixture("overlap.ts");
    let (ok, out) = env.complier(&["check", overlap.to_str().unwrap()]);
    assert!(!ok && out.contains("append ⊥ any: OVERLAP") && out.contains("NOT admitted"), "{out}");
    let (ok, out) = env.machine_up("bad", "writer.csp", "overlap.ts");
    assert!(!ok && out.contains("isn't admitted") && out.contains("OVERLAP"), "{out}");
    let (_, ls) = env.complier(&["machine", "ls"]);
    assert!(!ls.contains("bad"), "{ls}");

    // The machine is up, but this proxy can't run the CEL backend: it offers nothing.
    let (ok, out) = env.machine_up("m", "writer.csp", "fake.ts");
    assert!(ok, "{out}");
    let mut proxy = env.proxy("m", &[("COMPLIER_CEL", "/nonexistent/backend.json")]);
    assert!(proxy.tools().is_empty());
    let (ok, text) = proxy.call("write-item", json!({ "id": "x1" }));
    assert!(!ok, "{text}");
    assert!(env.calls().is_empty());
}

// The Notion unit, proven and exercised offline: `translate` calls nothing upstream.
#[test]
fn the_notion_unit_is_admitted_and_tells_overwrites_from_edits() {
    let unit = Path::new(env!("CARGO_MANIFEST_DIR")).join("../units/notion.ts");
    let unit = unit.to_str().unwrap();
    let run = |args: &[&str]| {
        let out = Command::new(BIN).args(args).output().unwrap();
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
}
