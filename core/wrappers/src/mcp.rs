//! MCP proxy glue. The proxy exposes a local stdio MCP server that forwards
//! calls to a downstream MCP server, gating each call through a `Session`.
//!
//! Architecture:
//! - parent agent speaks MCP to `McpProxyServer` over stdio
//! - `McpProxyServer` holds a running `RunningService<RoleClient, ()>` that
//!   it uses to talk to the downstream MCP server (spawned as a child process)
//! - `tools/list` on the proxy calls `list_all_tools` downstream, normalizes
//!   names with [`crate::naming::public_tool_name`], injects an optional
//!   `choice` parameter into each tool's input schema, and caches a
//!   public-name → downstream-name map
//! - `tools/call` on the proxy consults the session via [`McpGate`], and on
//!   allow forwards the call to the downstream client, recording the result

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Arc;

use rmcp::{
    ErrorData as McpError, RoleServer, ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, Content, ListToolsResult, PaginatedRequestParams,
        ServerCapabilities, ServerInfo, Tool,
    },
    service::{MaybeSendFuture, RequestContext, RunningService, RoleClient},
};
use serde_json::{Map, Value};
use session::Session;
use tokio::sync::Mutex;

use crate::blocked::BlockedToolResponse;
use crate::function::FunctionWrapper;
use crate::naming::{normalize_tool_name, public_tool_name};

/// Gates a single MCP `tools/call` through a shared session. Produced by
/// [`McpProxyServer`] for each incoming call.
#[derive(Clone)]
pub struct McpGate {
    namespace: String,
    wrapper: FunctionWrapper,
}

#[derive(Debug, Clone)]
pub enum McpCallOutcome {
    /// The session authorized this call. Dispatch to the downstream server.
    Allowed {
        internal_tool_name: String,
        kwargs: HashMap<String, Value>,
        next_actions_hint: Option<String>,
    },
    /// The session blocked this call. Return the blocked response to the agent.
    Blocked(BlockedToolResponse),
}

impl McpGate {
    pub fn new(namespace: impl Into<String>, session: Arc<Mutex<Session>>) -> Self {
        Self {
            namespace: namespace.into(),
            wrapper: FunctionWrapper::new(session),
        }
    }

    pub fn namespace(&self) -> &str {
        &self.namespace
    }

    pub fn wrapper(&self) -> &FunctionWrapper {
        &self.wrapper
    }

    /// Gate a downstream tool call identified by its *public* (agent-facing)
    /// name. The caller already knows the downstream original name — this
    /// method only concerns the session check and event recording.
    pub async fn gate(
        &self,
        public_tool_name: &str,
        mut kwargs: HashMap<String, Value>,
    ) -> McpCallOutcome {
        let choice = kwargs
            .remove("choice")
            .and_then(|v| v.as_str().map(str::to_owned));
        let internal = match normalize_tool_name(&self.namespace, public_tool_name) {
            Ok(s) => s,
            Err(e) => {
                return McpCallOutcome::Blocked(BlockedToolResponse {
                    tool_name: public_tool_name.into(),
                    reason: Some(e),
                    remediation: None,
                });
            }
        };

        let session = self.wrapper.session();
        let mut sess = session.lock().await;
        let decision = sess.check_tool_call(&internal, &kwargs, choice.as_deref());
        if !decision.allowed {
            sess.record_blocked_call(&internal, decision.clone());
            return McpCallOutcome::Blocked(BlockedToolResponse::from_decision(
                public_tool_name,
                &decision,
            ));
        }
        sess.record_allowed_call(&internal, kwargs.clone());

        let next_actions_hint = decision
            .remediation
            .as_ref()
            .filter(|r| !r.allowed_next_actions.is_empty())
            .map(|r| format!("Next allowed actions: {}", r.allowed_next_actions.join(", ")));

        McpCallOutcome::Allowed {
            internal_tool_name: internal,
            kwargs,
            next_actions_hint,
        }
    }

    /// Record a downstream result after a successful `Allowed` gating.
    pub async fn record_result(&self, internal_tool_name: &str, result: Value) {
        self.wrapper
            .session()
            .lock()
            .await
            .record_result(internal_tool_name, result);
    }
}

/// The rmcp `ServerHandler` that speaks MCP upstream (to the agent) while
/// forwarding through `McpGate` and down to a child MCP server.
#[derive(Clone)]
pub struct McpProxyServer {
    gate: McpGate,
    downstream: Arc<RunningService<RoleClient, ()>>,
    /// public (agent-facing) tool name → downstream original tool name
    public_to_downstream: Arc<Mutex<HashMap<String, String>>>,
}

impl McpProxyServer {
    pub fn new(gate: McpGate, downstream: RunningService<RoleClient, ()>) -> Self {
        Self {
            gate,
            downstream: Arc::new(downstream),
            public_to_downstream: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn resolve_downstream(&self, public_name: &str) -> Result<String, McpError> {
        if let Some(n) = self.public_to_downstream.lock().await.get(public_name).cloned() {
            return Ok(n);
        }
        // Map wasn't populated yet — refresh by listing downstream tools.
        self.refresh_tool_map().await?;
        self.public_to_downstream
            .lock()
            .await
            .get(public_name)
            .cloned()
            .ok_or_else(|| {
                McpError::invalid_params(
                    format!("Unknown wrapped tool: {public_name}"),
                    None,
                )
            })
    }

    async fn refresh_tool_map(&self) -> Result<Vec<Tool>, McpError> {
        let tools = self
            .downstream
            .list_all_tools()
            .await
            .map_err(|e| McpError::internal_error(format!("downstream list_tools failed: {e}"), None))?;

        let mut map = self.public_to_downstream.lock().await;
        map.clear();
        let mut rewritten: Vec<Tool> = Vec::with_capacity(tools.len());
        for tool in tools {
            let exposed = public_tool_name(&tool.name)
                .map_err(|e| McpError::internal_error(format!("normalize: {e}"), None))?;
            map.insert(exposed.clone(), tool.name.to_string());
            rewritten.push(rewrite_tool(exposed, tool));
        }
        Ok(rewritten)
    }
}

/// Rewrite a downstream tool for exposure: public name + `choice` param.
fn rewrite_tool(exposed_name: String, mut tool: Tool) -> Tool {
    tool.name = Cow::Owned(exposed_name.clone());
    if tool.title.is_none() {
        tool.title = Some(exposed_name);
    }
    // Inject an optional `choice` parameter so branch/unordered selection
    // is plumbed through to the session.
    let mut schema = (*tool.input_schema).clone();
    let props_entry = schema
        .entry("properties".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Value::Object(props) = props_entry {
        props.insert(
            "choice".to_string(),
            serde_json::json!({
                "type": "string",
                "description": "Optional branch or unordered-block choice label.",
            }),
        );
    }
    tool.input_schema = Arc::new(schema);
    tool
}

fn kwargs_from_arguments(args: Option<rmcp::model::JsonObject>) -> HashMap<String, Value> {
    args.map(|o| o.into_iter().collect()).unwrap_or_default()
}

fn kwargs_to_arguments(kwargs: HashMap<String, Value>) -> rmcp::model::JsonObject {
    kwargs.into_iter().collect()
}

impl ServerHandler for McpProxyServer {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, McpError>> + MaybeSendFuture + '_
    {
        async move {
            let tools = self.refresh_tool_map().await?;
            Ok(ListToolsResult::with_all_items(tools))
        }
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, McpError>> + MaybeSendFuture + '_
    {
        async move {
            let public_name = request.name.to_string();
            let kwargs = kwargs_from_arguments(request.arguments);

            match self.gate.gate(&public_name, kwargs).await {
                McpCallOutcome::Blocked(b) => {
                    let blob = serde_json::to_value(&b).unwrap_or(Value::Null);
                    let mut result =
                        CallToolResult::error(vec![Content::text(b.summary())]);
                    result.structured_content = Some(blob);
                    Ok(result)
                }
                McpCallOutcome::Allowed {
                    internal_tool_name,
                    kwargs,
                    next_actions_hint,
                } => {
                    let downstream_name = self.resolve_downstream(&public_name).await?;
                    let downstream_params = CallToolRequestParams::new(downstream_name)
                        .with_arguments(kwargs_to_arguments(kwargs));
                    let mut result = self
                        .downstream
                        .peer()
                        .call_tool(downstream_params)
                        .await
                        .map_err(|e| {
                            McpError::internal_error(
                                format!("downstream call_tool failed: {e}"),
                                None,
                            )
                        })?;

                    // Record the raw downstream result under the internal name.
                    let recorded =
                        serde_json::to_value(&result).unwrap_or(Value::Null);
                    self.gate.record_result(&internal_tool_name, recorded).await;

                    if let Some(hint) = next_actions_hint {
                        result.content.push(Content::text(hint));
                    }
                    Ok(result)
                }
            }
        }
    }
}
