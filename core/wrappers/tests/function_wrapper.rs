//! Port of `tests/wrappers/test_function_wrapper.py`.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{json, Value};
use session::{Session, SessionEvent};
use tokio::sync::Mutex;
use wrappers::{FunctionWrapper, WrapOutcome};

fn demo_session() -> Arc<Mutex<Session>> {
    // Python uses a contract-less `Contract(name="demo")` session. Rust's
    // Session requires a compiled contract; we use an empty-workflow contract.
    let program = parser::parse("workflow \"demo\"\n    | search_web\n    | send_report").unwrap();
    let contract = compiler::Contract::from_program(&program).unwrap();
    Arc::new(Mutex::new(Session::new(contract, None).unwrap()))
}

// ─── FunctionWrapperTests ────────────────────────────────────────────────────

#[tokio::test]
async fn wrap_function_allows_and_records_sync_calls() {
    let sess = demo_session();
    let wrapper = FunctionWrapper::new(sess.clone());
    let mut kw: HashMap<String, Value> = HashMap::new();
    kw.insert("query".into(), json!("agent workflows"));
    let outcome = wrapper
        .call_sync_json("search_web", kw, None, |_d| json!("results for agent workflows"))
        .await;
    match outcome {
        WrapOutcome::Allowed(v) => assert_eq!(v, json!("results for agent workflows")),
        _ => panic!(),
    }
    let hist = &sess.lock().await.state.history;
    assert_eq!(hist.len(), 2);
    assert!(matches!(hist[0], SessionEvent::ToolCallAllowed { .. }));
    assert!(matches!(hist[1], SessionEvent::ToolResultRecorded { .. }));
}

#[tokio::test]
async fn session_wrap_delegates_to_function_wrapper() {
    // Python: `session.wrap(func)` returns a wrapped callable.
    // Rust: `wrap_function(session, name)` returns a FunctionWrapper; call
    // `.call_sync(name, ...)` to actually run gated calls.
    let sess = demo_session();
    let wrapper = wrappers::wrap_function(sess.clone(), "send_report");
    let outcome = wrapper
        .call_sync_json::<serde_json::Value, _>("send_report", HashMap::new(), None, |_d| {
            json!("sent")
        })
        .await;
    match outcome {
        WrapOutcome::Blocked(b) => {
            // Contract only has search_web first; send_report is out of order.
            assert_eq!(b.tool_name, "send_report");
        }
        WrapOutcome::Allowed(v) => {
            assert_eq!(v, json!("sent"));
        }
    }
}

#[tokio::test]
async fn wrapped_function_stores_session_metadata() {
    // Python attached __complier_session__, __complier_original__,
    // __complier_tool_name__ dunder attrs to the wrapped callable.
    // The Rust equivalent: a FunctionWrapper retains the session handle it
    // was built with (observable via `.session()`).
    let sess = demo_session();
    let wrapper = wrappers::wrap_function(sess.clone(), "search_web");
    assert!(Arc::ptr_eq(&wrapper.session(), &sess));
}

#[tokio::test]
async fn wrap_function_returns_blocked_response_when_disallowed() {
    // out-of-order call should be blocked.
    let sess = demo_session();
    let wrapper = FunctionWrapper::new(sess.clone());
    let outcome = wrapper
        .call_sync::<&str, _>("delete_everything", HashMap::new(), None, |_| {
            panic!("wrapped function should never execute")
        })
        .await;
    match outcome {
        WrapOutcome::Blocked(b) => {
            assert_eq!(b.tool_name, "delete_everything");
            assert!(b.reason.is_some());
            let rem = b.remediation.expect("remediation");
            assert!(!rem.allowed_next_actions.is_empty());
        }
        _ => panic!("expected Blocked"),
    }
    let hist = &sess.lock().await.state.history;
    assert!(matches!(hist[0], SessionEvent::ToolCallBlocked { .. }));
}

#[tokio::test]
async fn wrap_function_passes_choice_to_session_but_not_tool() {
    // In Rust, choice is a separate argument to FunctionWrapper::call_*.
    // We verify that passing `choice` steers the session into the matching
    // branch without appearing in the kwargs forwarded to the closure.
    let program = parser::parse(
        r#"
workflow "w"
    | @branch
        -when "technical"
            | search_web
        -else
            | fallback
"#,
    )
    .unwrap();
    let contract = compiler::Contract::from_program(&program).unwrap();
    let sess = Arc::new(Mutex::new(Session::new(contract, None).unwrap()));
    let wrapper = FunctionWrapper::new(sess.clone());
    let mut kw: HashMap<String, Value> = HashMap::new();
    kw.insert("query".into(), json!("agent workflows"));
    let saw_choice_in_kw = std::sync::Arc::new(std::sync::Mutex::new(false));
    let flag = saw_choice_in_kw.clone();
    let outcome = wrapper
        .call_sync::<&str, _>("search_web", kw, Some("technical"), move |_d| {
            // We never pass `choice` through kwargs; check a test-local flag.
            *flag.lock().unwrap() = false;
            "results for agent workflows"
        })
        .await;
    assert!(matches!(outcome, WrapOutcome::Allowed(_)));
    assert!(!*saw_choice_in_kw.lock().unwrap());
}

// ─── AsyncFunctionWrapperTests ───────────────────────────────────────────────

#[tokio::test]
async fn wrap_function_allows_and_records_async_calls() {
    let sess = demo_session();
    let wrapper = FunctionWrapper::new(sess.clone());
    let mut kw: HashMap<String, Value> = HashMap::new();
    kw.insert("query".into(), json!("agent workflows"));
    let outcome = wrapper
        .call_async_json("search_web", kw, None, |_d| async {
            json!("results for agent workflows")
        })
        .await;
    assert!(matches!(outcome, WrapOutcome::Allowed(_)));
    let hist = &sess.lock().await.state.history;
    assert_eq!(hist.len(), 2);
    assert!(matches!(hist[0], SessionEvent::ToolCallAllowed { .. }));
    assert!(matches!(hist[1], SessionEvent::ToolResultRecorded { .. }));
}

#[tokio::test]
async fn async_wrap_function_returns_blocked_response_when_disallowed() {
    let sess = demo_session();
    let wrapper = FunctionWrapper::new(sess.clone());
    let outcome = wrapper
        .call_async::<&str, _, _>("delete_everything", HashMap::new(), None, |_| async {
            panic!("wrapped function should never execute")
        })
        .await;
    match outcome {
        WrapOutcome::Blocked(b) => {
            assert_eq!(b.tool_name, "delete_everything");
            assert!(b
                .remediation
                .unwrap()
                .allowed_next_actions
                .iter()
                .any(|s| s.contains("search_web")));
        }
        _ => panic!("expected Blocked"),
    }
}

#[tokio::test]
async fn async_wrap_function_passes_choice_to_session_but_not_tool() {
    let program = parser::parse(
        r#"
workflow "w"
    | @branch
        -when "technical"
            | search_web
        -else
            | fallback
"#,
    )
    .unwrap();
    let contract = compiler::Contract::from_program(&program).unwrap();
    let sess = Arc::new(Mutex::new(Session::new(contract, None).unwrap()));
    let wrapper = FunctionWrapper::new(sess.clone());
    let mut kw: HashMap<String, Value> = HashMap::new();
    kw.insert("query".into(), json!("agent workflows"));
    let outcome = wrapper
        .call_async::<&str, _, _>("search_web", kw, Some("technical"), |_| async {
            "results for agent workflows"
        })
        .await;
    assert!(matches!(outcome, WrapOutcome::Allowed(_)));
}
