// Minimal MCP client: JSON-RPC 2.0 over stdio (newline-delimited) or Streamable HTTP.

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

const PROTOCOL_VERSION: &str = "2025-06-18";

trait Transport {
    // Sends a request and returns the response message carrying the same id.
    fn request(&mut self, message: Value) -> Result<Value>;
    fn notify(&mut self, message: Value) -> Result<()>;
    fn negotiated(&mut self, _version: &str) {}
}

pub struct Client {
    transport: Box<dyn Transport>,
    next_id: u64,
}

impl Client {
    pub fn stdio(command: &[String], env: &[(String, String)]) -> Result<Self> {
        Ok(Self::new(StdioTransport::spawn(command, env)?))
    }

    pub fn http(url: &str, token: &str) -> Result<Self> {
        Ok(Self::new(HttpTransport::new(url, token)?))
    }

    fn new(transport: impl Transport + 'static) -> Self {
        Self { transport: Box::new(transport), next_id: 1 }
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
        if let Some(version) = result["protocolVersion"].as_str() {
            self.transport.negotiated(version);
        }
        self.transport.notify(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))?;
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

    pub fn call_tool(&mut self, name: &str, arguments: Value) -> Result<Value> {
        self.request("tools/call", json!({ "name": name, "arguments": arguments }))
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let response = self
            .transport
            .request(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        if let Some(error) = response.get("error") {
            bail!("{method} failed: {error}");
        }
        Ok(response["result"].clone())
    }
}

// A response to our request, as opposed to a server notification or server-initiated request.
fn is_response_to(message: &Value, request: &Value) -> bool {
    message.get("method").is_none() && message["id"] == request["id"]
}

struct StdioTransport {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl StdioTransport {
    fn spawn(command: &[String], env: &[(String, String)]) -> Result<Self> {
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
        Ok(Self { child, stdin, stdout })
    }

    fn send(&mut self, message: &Value) -> Result<()> {
        writeln!(self.stdin, "{message}")?;
        Ok(self.stdin.flush()?)
    }
}

impl Transport for StdioTransport {
    fn request(&mut self, message: Value) -> Result<Value> {
        self.send(&message)?;
        loop {
            let mut line = String::new();
            if self.stdout.read_line(&mut line)? == 0 {
                return Err(anyhow!("server closed the connection"));
            }
            let reply: Value = serde_json::from_str(&line)?;
            if is_response_to(&reply, &message) {
                return Ok(reply);
            }
        }
    }

    fn notify(&mut self, message: Value) -> Result<()> {
        self.send(&message)
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct HttpTransport {
    http: reqwest::blocking::Client,
    url: String,
    token: String,
    session: Option<String>,
    version: Option<String>,
}

impl HttpTransport {
    fn new(url: &str, token: &str) -> Result<Self> {
        Ok(Self {
            http: reqwest::blocking::Client::new(),
            url: url.to_string(),
            token: token.to_string(),
            session: None,
            version: None,
        })
    }

    fn post(&mut self, message: &Value) -> Result<reqwest::blocking::Response> {
        let mut request = self
            .http
            .post(&self.url)
            .bearer_auth(&self.token)
            .header("Accept", "application/json, text/event-stream")
            .json(message);
        if let Some(session) = &self.session {
            request = request.header("Mcp-Session-Id", session);
        }
        if let Some(version) = &self.version {
            request = request.header("MCP-Protocol-Version", version);
        }
        let response = request.send()?;
        if let Some(session) = response.headers().get("mcp-session-id").and_then(|h| h.to_str().ok()) {
            self.session = Some(session.to_string());
        }
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            bail!("server rejected the access token; run `complier add` again");
        }
        Ok(response.error_for_status()?)
    }
}

impl Transport for HttpTransport {
    fn request(&mut self, message: Value) -> Result<Value> {
        let response = self.post(&message)?;
        let event_stream = response
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|t| t.starts_with("text/event-stream"));
        if !event_stream {
            return Ok(response.json()?);
        }
        // Read SSE events until the one carrying our response; the stream may stay open after it.
        for line in BufReader::new(response).lines() {
            let line = line?;
            let Some(data) = line.strip_prefix("data:") else { continue };
            let reply: Value = serde_json::from_str(data.trim())?;
            if is_response_to(&reply, &message) {
                return Ok(reply);
            }
        }
        bail!("event stream ended before the response arrived")
    }

    fn notify(&mut self, message: Value) -> Result<()> {
        self.post(&message)?;
        Ok(())
    }

    fn negotiated(&mut self, version: &str) {
        self.version = Some(version.to_string());
    }
}
