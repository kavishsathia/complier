// Minimal MCP client over stdio: newline-delimited JSON-RPC 2.0.

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

const PROTOCOL_VERSION: &str = "2025-06-18";

pub struct Client {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl Client {
    pub fn spawn(command: &[String], env: &[(String, String)]) -> Result<Self> {
        let (program, args) = command.split_first().context("empty command")?;
        let mut child = Command::new(program)
            .args(args)
            .envs(env.iter().map(|(k, v)| (k, v)))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .with_context(|| format!("spawning {program}"))?;
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Ok(Self { child, stdin, stdout, next_id: 1 })
    }

    pub fn initialize(&mut self) -> Result<Value> {
        let result = self.request(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "complier", "version": env!("CARGO_PKG_VERSION") },
            }),
        )?;
        self.notify("notifications/initialized", json!({}))?;
        Ok(result)
    }

    pub fn list_tools(&mut self) -> Result<Vec<Value>> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let params = match &cursor {
                Some(c) => json!({ "cursor": c }),
                None => json!({}),
            };
            let page = self.request("tools/list", params)?;
            tools.extend(page["tools"].as_array().cloned().unwrap_or_default());
            match page["nextCursor"].as_str() {
                Some(c) => cursor = Some(c.to_string()),
                None => return Ok(tools),
            }
        }
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        loop {
            let message = self.recv()?;
            // Skip server notifications and requests until our response arrives.
            if message["id"] != json!(id) || message.get("method").is_some() {
                continue;
            }
            if let Some(error) = message.get("error") {
                bail!("{method} failed: {error}");
            }
            return Ok(message["result"].clone());
        }
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<()> {
        self.send(json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    fn send(&mut self, message: Value) -> Result<()> {
        writeln!(self.stdin, "{message}")?;
        Ok(self.stdin.flush()?)
    }

    fn recv(&mut self) -> Result<Value> {
        let mut line = String::new();
        if self.stdout.read_line(&mut line)? == 0 {
            return Err(anyhow!("server closed the connection"));
        }
        Ok(serde_json::from_str(&line)?)
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
