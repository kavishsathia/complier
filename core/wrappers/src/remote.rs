//! Remote HTTP MCP proxy — port of Python's `complier.wrappers.remote_mcp` +
//! `remote_http_proxy`. A single axum server is spun up per session; each
//! `wrap_remote_mcp` call `POST`s `/setup` to register a new namespace. Agents
//! hit `/mcp/{namespace}/` and the proxy forwards to the registered downstream
//! URL via rmcp's streamable-HTTP client, gating every `tools/call` through
//! the session.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{Path as AxumPath, Request as AxumRequest, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{any, post},
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use session::Session;
use tokio::sync::{Mutex, RwLock};

use crate::blocked::BlockedToolResponse;
use crate::mcp::McpGate;
use crate::naming::{normalize_tool_name, public_tool_name};

/// Connection details returned from `wrap_remote_mcp` — mirrors Python's
/// `RemoteMCPDetails`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteMCPDetails {
    pub namespace: String,
    pub url: String,
}

/// Shared state across all `/mcp/{ns}` requests. Each namespace registers its
/// downstream URL + optional bearer token via `POST /setup`.
#[derive(Debug, Default)]
pub struct RemoteRegistry {
    pub namespaces: HashMap<String, String>, // ns → downstream URL
    pub auth_tokens: HashMap<String, String>,
}

impl RemoteRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, namespace: String, url: String, auth_token: Option<String>) {
        self.namespaces.insert(namespace.clone(), url);
        if let Some(t) = auth_token {
            self.auth_tokens.insert(namespace, t);
        }
    }

    pub fn downstream_url(&self, namespace: &str) -> Result<&str, String> {
        self.namespaces
            .get(namespace)
            .map(String::as_str)
            .ok_or_else(|| format!("Unknown namespace: {namespace}"))
    }

    pub fn resolve_auth(&self, namespace: &str, header: Option<&str>) -> Option<String> {
        if let Some(tok) = self.auth_tokens.get(namespace) {
            return Some(format!("Bearer {tok}"));
        }
        header.map(|s| s.to_owned())
    }
}

/// Extract `namespace` from an MCP path like `/mcp/notion/` or `/mcp/notion`.
/// Mirrors Python `_namespace_from_request`.
pub fn namespace_from_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim_end_matches('/');
    let prefix = "/mcp/";
    if !trimmed.starts_with(prefix) {
        return Err(format!("Unexpected MCP path: {path}"));
    }
    let ns = &trimmed[prefix.len()..];
    // Strip any further path segments (e.g. `/mcp/notion/tools/call`).
    let ns = ns.split('/').next().unwrap_or("");
    if ns.is_empty() {
        return Err("Missing MCP namespace.".into());
    }
    Ok(ns.to_owned())
}

/// Read the `Authorization` header value, if any.
pub fn authorization_header(headers: &HeaderMap) -> Option<String> {
    headers
        .get(http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_owned())
}

// ── shared app state ────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    registry: Arc<RwLock<RemoteRegistry>>,
    session: Arc<Mutex<Session>>,
}

#[derive(Debug, Deserialize)]
struct SetupPayload {
    namespace: String,
    downstream_url: String,
    auth_token: Option<String>,
}

async fn setup_handler(
    State(state): State<AppState>,
    Json(payload): Json<SetupPayload>,
) -> impl IntoResponse {
    let mut reg = state.registry.write().await;
    reg.register(
        payload.namespace.clone(),
        payload.downstream_url,
        payload.auth_token,
    );
    Json(json!({
        "ok": true,
        "namespace": payload.namespace,
        "url": format!("/mcp/{}/", payload.namespace),
    }))
}

async fn mcp_handler(
    State(state): State<AppState>,
    AxumPath(namespace): AxumPath<String>,
    request: AxumRequest,
) -> Response {
    let reg = state.registry.read().await;
    let downstream_url = match reg.downstream_url(&namespace) {
        Ok(u) => u.to_owned(),
        Err(e) => return (StatusCode::NOT_FOUND, e).into_response(),
    };
    let auth = reg.resolve_auth(&namespace, authorization_header(request.headers()).as_deref());
    drop(reg);

    // Pull the request body; it's the MCP JSON-RPC payload.
    let body = match axum::body::to_bytes(request.into_body(), usize::MAX).await {
        Ok(b) => b,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("body: {e}")).into_response(),
    };
    let body_str = match std::str::from_utf8(&body) {
        Ok(s) => s.to_owned(),
        Err(_) => return (StatusCode::BAD_REQUEST, "non-utf8 body").into_response(),
    };

    // Parse as JSON-RPC; only `tools/call` needs session gating.
    let rpc: Value = match serde_json::from_str(&body_str) {
        Ok(v) => v,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("json: {e}")).into_response(),
    };
    let method = rpc.get("method").and_then(Value::as_str).unwrap_or("");

    if method == "tools/call" {
        let params = rpc.get("params").cloned().unwrap_or(json!({}));
        let public_name = params
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let mut args: HashMap<String, Value> = params
            .get("arguments")
            .and_then(|v| v.as_object())
            .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();
        let choice = args
            .remove("choice")
            .and_then(|v| v.as_str().map(str::to_owned));

        let gate = McpGate::new(namespace.clone(), state.session.clone());
        let session = state.session.clone();
        let mut sess = session.lock().await;
        let internal = match normalize_tool_name(&namespace, &public_name) {
            Ok(s) => s,
            Err(e) => {
                return (StatusCode::BAD_REQUEST, e).into_response();
            }
        };
        let decision = sess.check_tool_call(&internal, &args, choice.as_deref());
        if !decision.allowed {
            sess.record_blocked_call(&internal, decision.clone());
            drop(sess);
            let blocked = BlockedToolResponse::from_decision(&public_name, &decision);
            let rpc_resp = json!({
                "jsonrpc": "2.0",
                "id": rpc.get("id").cloned().unwrap_or(Value::Null),
                "result": {
                    "content": [{"type": "text", "text": blocked.summary()}],
                    "structuredContent": serde_json::to_value(&blocked).unwrap_or(Value::Null),
                    "isError": true,
                },
            });
            return (StatusCode::OK, Json(rpc_resp)).into_response();
        }
        sess.record_allowed_call(&internal, args.clone());
        let next_hint = decision
            .remediation
            .as_ref()
            .filter(|r| !r.allowed_next_actions.is_empty())
            .map(|r| format!("Next allowed actions: {}", r.allowed_next_actions.join(", ")));
        drop(sess);

        // Forward to downstream. Resolve the downstream tool's real name via a
        // `tools/list` call the first time we see this namespace/public name.
        let downstream_name = match resolve_downstream_tool(&downstream_url, &auth, &public_name)
            .await
        {
            Ok(n) => n,
            Err(e) => return (StatusCode::BAD_GATEWAY, e).into_response(),
        };
        let mut forward_params = json!({
            "name": downstream_name,
            "arguments": args,
        });
        // Preserve id + jsonrpc envelope for downstream.
        let forward_body = json!({
            "jsonrpc": "2.0",
            "id": rpc.get("id").cloned().unwrap_or(Value::Null),
            "method": "tools/call",
            "params": forward_params.take(),
        });
        match forward_rpc(&downstream_url, &auth, &forward_body).await {
            Ok(mut resp) => {
                // Append next-actions hint to result.content if allowed.
                if let Some(hint) = next_hint {
                    if let Some(result) = resp.get_mut("result") {
                        if let Some(content) = result.get_mut("content") {
                            if let Some(arr) = content.as_array_mut() {
                                arr.push(json!({"type": "text", "text": hint}));
                            }
                        }
                    }
                }
                // Record raw downstream result.
                let mut sess = state.session.lock().await;
                sess.record_result(&internal, resp.clone());
                drop(sess);
                let _ = gate;
                (StatusCode::OK, Json(resp)).into_response()
            }
            Err(e) => (StatusCode::BAD_GATEWAY, e).into_response(),
        }
    } else if method == "tools/list" {
        // Forward to downstream, rewrite names with `public_tool_name` + inject choice.
        match forward_rpc(&downstream_url, &auth, &rpc).await {
            Ok(mut resp) => {
                if let Some(result) = resp.get_mut("result") {
                    if let Some(tools) = result.get_mut("tools").and_then(|v| v.as_array_mut()) {
                        for tool in tools.iter_mut() {
                            if let Some(name) = tool.get("name").and_then(Value::as_str) {
                                if let Ok(exposed) = public_tool_name(name) {
                                    tool["name"] = Value::String(exposed.clone());
                                    if tool.get("title").is_none() {
                                        tool["title"] = Value::String(exposed);
                                    }
                                }
                            }
                            if let Some(schema) = tool.get_mut("inputSchema") {
                                if let Some(obj) = schema.as_object_mut() {
                                    let props = obj
                                        .entry("properties".to_string())
                                        .or_insert_with(|| Value::Object(Default::default()));
                                    if let Some(p) = props.as_object_mut() {
                                        p.insert(
                                            "choice".to_string(),
                                            json!({
                                                "type": "string",
                                                "description": "Optional branch or unordered-block choice label."
                                            }),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                (StatusCode::OK, Json(resp)).into_response()
            }
            Err(e) => (StatusCode::BAD_GATEWAY, e).into_response(),
        }
    } else {
        // Pass-through for initialize / notifications / other methods.
        match forward_rpc(&downstream_url, &auth, &rpc).await {
            Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
            Err(e) => (StatusCode::BAD_GATEWAY, e).into_response(),
        }
    }
}

/// Forward a JSON-RPC payload to the downstream MCP HTTP endpoint.
async fn forward_rpc(
    downstream_url: &str,
    auth: &Option<String>,
    payload: &Value,
) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let mut req = client
        .post(downstream_url)
        .header(http::header::CONTENT_TYPE, "application/json")
        .header(http::header::ACCEPT, "application/json, text/event-stream");
    if let Some(a) = auth {
        req = req.header(http::header::AUTHORIZATION, a);
    }
    let resp = req
        .json(payload)
        .send()
        .await
        .map_err(|e| format!("downstream request failed: {e}"))?;
    let text = resp
        .text()
        .await
        .map_err(|e| format!("downstream body: {e}"))?;
    // Downstream may respond with either JSON or SSE-framed JSON; try plain first.
    if let Ok(v) = serde_json::from_str::<Value>(&text) {
        return Ok(v);
    }
    // Strip SSE "data:" prefix if present.
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("data: ") {
            if let Ok(v) = serde_json::from_str::<Value>(rest.trim()) {
                return Ok(v);
            }
        }
    }
    Err(format!("unexpected downstream response: {text}"))
}

/// List downstream tools and return the original name for a given public name.
async fn resolve_downstream_tool(
    downstream_url: &str,
    auth: &Option<String>,
    public_name: &str,
) -> Result<String, String> {
    let rpc = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
        "params": {}
    });
    let resp = forward_rpc(downstream_url, auth, &rpc).await?;
    let tools = resp
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(Value::as_array)
        .ok_or_else(|| "downstream tools/list had no tools array".to_string())?;
    for tool in tools {
        if let Some(name) = tool.get("name").and_then(Value::as_str) {
            if let Ok(exposed) = public_tool_name(name) {
                if exposed == public_name {
                    return Ok(name.to_string());
                }
            }
        }
    }
    Err(format!("Unknown wrapped tool: {public_name}"))
}

/// Build the axum app for the remote proxy.
pub fn build_app(registry: Arc<RwLock<RemoteRegistry>>, session: Arc<Mutex<Session>>) -> Router {
    let state = AppState { registry, session };
    Router::new()
        .route("/setup", post(setup_handler))
        .route("/mcp/{namespace}", any(mcp_handler))
        .route("/mcp/{namespace}/", any(mcp_handler))
        .route("/mcp/{namespace}/{*rest}", any(mcp_handler))
        .with_state(state)
}

/// Run the proxy server on `addr`. Returns when the server shuts down.
pub async fn serve(
    addr: SocketAddr,
    registry: Arc<RwLock<RemoteRegistry>>,
    session: Arc<Mutex<Session>>,
) -> Result<(), std::io::Error> {
    let app = build_app(registry, session);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await
}

// ── top-level helper mirroring Python's `wrap_remote_mcp` ───────────────────

/// Register a remote MCP server under `namespace`. The caller must have
/// already started the proxy (see `serve`); this helper only POSTs `/setup`.
pub async fn wrap_remote_mcp(
    proxy_base_url: &str,
    namespace: &str,
    downstream_url: &str,
    auth_token: Option<&str>,
) -> Result<RemoteMCPDetails, String> {
    let client = reqwest::Client::new();
    let payload = json!({
        "namespace": namespace,
        "downstream_url": downstream_url,
        "auth_token": auth_token,
    });
    let resp = client
        .post(format!("{proxy_base_url}/setup"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("setup POST failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("setup returned status {}", resp.status()));
    }
    Ok(RemoteMCPDetails {
        namespace: namespace.to_owned(),
        url: format!("{proxy_base_url}/mcp/{namespace}/"),
    })
}

/// Wait for a TCP port to accept connections. Mirrors Python's `_wait_for_port`.
pub async fn wait_for_port(
    host: &str,
    port: u16,
    timeout: std::time::Duration,
) -> Result<(), std::io::Error> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!("timed out waiting for port {port}"),
            ));
        }
        match tokio::net::TcpStream::connect((host, port)).await {
            Ok(_) => return Ok(()),
            Err(_) => tokio::time::sleep(std::time::Duration::from_millis(50)).await,
        }
    }
}
