//! End-to-end proxy test. Wires a fake downstream MCP server to the
//! proxy over an in-memory duplex, then drives the proxy as a client to
//! exercise `tools/list`, an allowed `tools/call`, and a blocked call.

use std::sync::Arc;

use rmcp::{
    ErrorData as McpError, RoleServer, ServerHandler, ServiceExt,
    model::{
        CallToolRequestParams, CallToolResult, Content, ListToolsResult, PaginatedRequestParams,
        ServerCapabilities, ServerInfo, Tool,
    },
    service::{MaybeSendFuture, RequestContext},
};
use serde_json::json;
use session::{EvalResult, ModelEvaluator, Session};
use tokio::sync::Mutex;
use wrappers::mcp::{McpGate, McpProxyServer};

const CONTRACT: &str = r#"
guarantee safe 'no harmful content {safe}'

workflow "research"
    @always safe
    | ns.search_web query='focused and specific [query_focused]'
    | ns.summarize content='clear and concise [summary_clear]'
    | ns.save_note
"#;

struct AlwaysPass;
impl ModelEvaluator for AlwaysPass {
    fn evaluate(&self, _prose: &str, _value: &str) -> EvalResult {
        EvalResult::pass()
    }
}

/// A minimal downstream MCP server exposing three tools matching the
/// contract. All calls just echo their arguments.
#[derive(Clone)]
struct FakeDownstream;

impl ServerHandler for FakeDownstream {
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
            let schema = Arc::new(
                serde_json::from_value::<rmcp::model::JsonObject>(json!({
                    "type": "object",
                    "properties": {"query": {"type": "string"}, "content": {"type": "string"}}
                }))
                .unwrap(),
            );
            let tools = vec![
                Tool::new("search_web", "search the web", schema.clone()),
                Tool::new("summarize", "summarize text", schema.clone()),
                Tool::new("save_note", "persist a note", schema),
            ];
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
            let echo = format!(
                "downstream:{}:{}",
                request.name,
                request
                    .arguments
                    .map(|a| serde_json::to_string(&a).unwrap_or_default())
                    .unwrap_or_default()
            );
            Ok(CallToolResult::success(vec![Content::text(echo)]))
        }
    }
}

fn build_session() -> Arc<Mutex<Session>> {
    let program = parser::parse(CONTRACT).expect("parse");
    let contract = compiler::Contract::from_program(&program).expect("compile");
    let session = Session::new(contract, None)
        .expect("session")
        .with_model(Box::new(AlwaysPass));
    Arc::new(Mutex::new(session))
}

#[tokio::test]
async fn proxy_forwards_list_and_gates_calls() -> anyhow::Result<()> {
    // downstream (fake) ↔ proxy internal client
    let (ds_server_t, ds_client_t) = tokio::io::duplex(8192);
    // parent agent (driver) ↔ proxy outward server
    let (proxy_server_t, driver_t) = tokio::io::duplex(8192);

    // Start the fake downstream server.
    tokio::spawn(async move {
        let svc = FakeDownstream.serve(ds_server_t).await?;
        svc.waiting().await?;
        anyhow::Ok(())
    });

    // Proxy's internal client speaking to the downstream.
    let downstream_client = ().serve(ds_client_t).await?;

    // Build the proxy.
    let session = build_session();
    let gate = McpGate::new("ns", session.clone());
    let proxy = McpProxyServer::new(gate, downstream_client);

    // Serve proxy to the driver.
    tokio::spawn(async move {
        let running = proxy.serve(proxy_server_t).await?;
        running.waiting().await?;
        anyhow::Ok(())
    });

    // Drive the proxy as a client.
    let driver = ().serve(driver_t).await?;

    // 1. list_tools: public names should be normalized, with `choice` injected.
    let tools = driver.list_all_tools().await?;
    let names: Vec<String> = tools.iter().map(|t| t.name.to_string()).collect();
    assert!(names.contains(&"search_web".to_string()));
    assert!(names.contains(&"summarize".to_string()));
    let search = tools.iter().find(|t| t.name == "search_web").unwrap();
    let props = search
        .input_schema
        .get("properties")
        .and_then(|v| v.as_object())
        .expect("properties");
    assert!(props.contains_key("choice"));

    // 2. Blocked call: `summarize` is not yet allowed before `search_web`.
    let mut args_early: rmcp::model::JsonObject = Default::default();
    args_early.insert("content".to_string(), json!("whatever"));
    let blocked = driver
        .call_tool(CallToolRequestParams::new("summarize").with_arguments(args_early))
        .await?;
    assert_eq!(blocked.is_error, Some(true));
    let structured = blocked.structured_content.clone().expect("structured content");
    assert_eq!(structured["tool_name"], "summarize");

    // 3. Allowed call: first step in the workflow is `search_web`.
    let mut args: rmcp::model::JsonObject = Default::default();
    args.insert("query".to_string(), json!("focused and specific"));
    let result = driver
        .call_tool(CallToolRequestParams::new("search_web").with_arguments(args))
        .await?;
    assert_eq!(result.is_error, Some(false));
    let text = result
        .content
        .iter()
        .find_map(|c| {
            serde_json::to_value(c).ok().and_then(|v| {
                v.get("text").and_then(|t| t.as_str().map(str::to_owned))
            })
        })
        .expect("text content");
    assert!(text.contains("downstream:search_web"));

    // Session should have recorded three events: blocked, allowed, result.
    let history = session.lock().await.state.history.clone();
    assert_eq!(history.len(), 3);

    // Cleanup: close the driver (will shut down the proxy loop).
    driver.cancel().await?;
    Ok(())
}
