use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{json, Value};
use session::{EvalResult, ModelEvaluator, Session, SessionEvent};
use tokio::sync::Mutex;
use wrappers::{FunctionWrapper, WrapOutcome};

const CONTRACT: &str = r#"
guarantee safe 'no harmful content {safe}'

workflow "research"
    @always safe
    | search_web query='focused and specific [query_focused]'
    | summarize content='clear and concise [summary_clear]'
    | save_note
"#;

struct AlwaysPass;
impl ModelEvaluator for AlwaysPass {
    fn evaluate(&self, _prose: &str, _value: &str) -> EvalResult {
        EvalResult::pass()
    }
}

struct RejectQuery;
impl ModelEvaluator for RejectQuery {
    fn evaluate(&self, _prose: &str, value: &str) -> EvalResult {
        if value.contains("bad") {
            EvalResult::fail("query not focused")
        } else {
            EvalResult::pass()
        }
    }
}

fn build_session(evaluator: Box<dyn ModelEvaluator>) -> Arc<Mutex<Session>> {
    let program = parser::parse(CONTRACT).expect("parse");
    let contract = compiler::Contract::from_program(&program).expect("compile");
    let session = Session::new(contract, None).expect("session").with_model(evaluator);
    Arc::new(Mutex::new(session))
}

#[tokio::test]
async fn allowed_call_records_result() {
    let sess = build_session(Box::new(AlwaysPass));
    let wrapper = FunctionWrapper::new(sess.clone());

    let mut kwargs: HashMap<String, Value> = HashMap::new();
    kwargs.insert("query".into(), json!("focused search"));

    let outcome = wrapper
        .call_sync_json("search_web", kwargs, None, |_d| json!({"hits": 3}))
        .await;
    assert!(matches!(outcome, WrapOutcome::Allowed(_)));

    let history = &sess.lock().await.state.history;
    assert_eq!(history.len(), 2);
    assert!(matches!(history[0], SessionEvent::ToolCallAllowed { .. }));
    assert!(matches!(history[1], SessionEvent::ToolResultRecorded { .. }));
}

#[tokio::test]
async fn blocks_unexpected_tool() {
    let sess = build_session(Box::new(AlwaysPass));
    let wrapper = FunctionWrapper::new(sess.clone());

    let outcome = wrapper
        .call_sync("summarize", HashMap::new(), None, |_| "should not run")
        .await;
    match outcome {
        WrapOutcome::Blocked(b) => {
            assert_eq!(b.tool_name, "summarize");
            let rem = b.remediation.unwrap();
            assert!(rem.allowed_next_actions.iter().any(|s| s.contains("search_web")));
        }
        _ => panic!("expected Blocked"),
    }

    let history = &sess.lock().await.state.history;
    assert!(matches!(history[0], SessionEvent::ToolCallBlocked { .. }));
}

#[tokio::test]
async fn failed_guard_surfaces_retry() {
    let sess = build_session(Box::new(RejectQuery));
    let wrapper = FunctionWrapper::new(sess.clone());

    let mut kwargs: HashMap<String, Value> = HashMap::new();
    kwargs.insert("query".into(), json!("bad and lazy"));

    let outcome = wrapper
        .call_sync("search_web", kwargs, None, |_| "unreached")
        .await;
    match outcome {
        WrapOutcome::Blocked(b) => {
            let rem = b.remediation.expect("remediation");
            assert!(rem.allowed_next_actions.contains(&"search_web".to_string()));
            assert!(rem.missing_requirements.iter().any(|r| r.contains("not focused")));
        }
        _ => panic!("expected Blocked"),
    }
}
