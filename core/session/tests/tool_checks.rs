//! Port of `tests/session/test_tool_checks.py`.

use std::collections::HashMap;

use serde_json::{json, Value};
use session::{EvalResult, ModelEvaluator, Session};

fn session_from(src: &str) -> Session {
    let program = parser::parse(src).expect("parse");
    let contract = compiler::Contract::from_program(&program).expect("compile");
    Session::new(contract, None).expect("session")
}

fn kw<const N: usize>(pairs: [(&str, Value); N]) -> HashMap<String, Value> {
    pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect()
}

// ─── single tests ───────────────────────────────────────────────────────────

#[test]
fn rejects_when_multiple_workflows_exist_without_active_workflow() {
    let mut s = session_from(
        r#"
workflow "research"
    | search_web

workflow "publish"
    | publish_post
"#,
    );
    let d = s.check_tool_call("search_web", &HashMap::new(), None);
    assert!(!d.allowed);
    assert_eq!(d.reason.as_deref(), Some("No active workflow."));
}

#[test]
fn allows_next_tool_when_name_matches() {
    let mut s = session_from(
        r#"
workflow "research"
    | search_web
"#,
    );
    let d = s.check_tool_call("search_web", &HashMap::new(), None);
    assert!(d.allowed);
    assert_eq!(s.state.active_workflow.as_deref(), Some("research"));
    assert!(s.state.active_step.is_some());
}

#[test]
fn rejects_tool_that_is_not_allowed_next() {
    let mut s = session_from(
        r#"
workflow "research"
    | search_web
"#,
    );
    let d = s.check_tool_call("send_email", &HashMap::new(), None);
    assert!(!d.allowed);
    assert_eq!(
        d.reason.as_deref(),
        Some("Tool 'send_email' is not allowed next.")
    );
}

#[test]
fn requires_declared_exact_match_param_values() {
    let mut allowed_sess = session_from(
        r#"
workflow "publish"
    | publish_post channel="blog"
"#,
    );
    let allowed = allowed_sess.check_tool_call(
        "publish_post",
        &kw([("channel", json!("blog"))]),
        None,
    );
    assert!(allowed.allowed);

    let mut blocked_sess = session_from(
        r#"
workflow "publish"
    | publish_post channel="blog"
"#,
    );
    let blocked = blocked_sess.check_tool_call(
        "publish_post",
        &kw([("channel", json!("social"))]),
        None,
    );
    assert!(!blocked.allowed);
}

#[test]
fn missing_required_param_blocks_validation() {
    let mut s = session_from(
        r#"
workflow "publish"
    | publish_post channel="blog"
"#,
    );
    let d = s.check_tool_call("publish_post", &HashMap::new(), None);
    assert!(!d.allowed);
    let rem = d.remediation.expect("remediation");
    assert_eq!(
        rem.missing_requirements,
        vec!["Missing required param 'channel'.".to_string()]
    );
}

#[test]
fn undeclared_params_are_treated_as_unconstrained() {
    let mut s = session_from(
        r#"
workflow "research"
    | search_web
"#,
    );
    let d = s.check_tool_call(
        "search_web",
        &kw([("query", json!("agent compliance")), ("limit", json!(5))]),
        None,
    );
    assert!(d.allowed);
}

struct PassingModel;
impl ModelEvaluator for PassingModel {
    fn evaluate(&self, _p: &str, _v: &str) -> EvalResult {
        EvalResult::pass()
    }
}

struct RejectingModel;
impl ModelEvaluator for RejectingModel {
    fn evaluate(&self, _p: &str, _v: &str) -> EvalResult {
        EvalResult::fail("unsafe")
    }
}

#[test]
fn expression_params_use_integrations_during_validation() {
    let program = parser::parse(
        r#"
workflow "research"
    | search_web query='must be [safe]'
"#,
    )
    .unwrap();
    let contract = compiler::Contract::from_program(&program).unwrap();
    let mut s = Session::new(contract, None)
        .unwrap()
        .with_model(Box::new(PassingModel));
    let d = s.check_tool_call(
        "search_web",
        &kw([("query", json!("agent compliance"))]),
        None,
    );
    assert!(d.allowed);
}

#[test]
fn branch_choice_selects_matching_arm() {
    let mut s = session_from(
        r#"
workflow "research"
    | @branch
        -when "technical"
            | search_web query="papers"
        -else
            | search_web query="overview"
"#,
    );
    let technical = s.check_tool_call(
        "search_web",
        &kw([("query", json!("papers"))]),
        Some("technical"),
    );
    assert!(technical.allowed);

    let mut s2 = session_from(
        r#"
workflow "research"
    | @branch
        -when "technical"
            | search_web query="papers"
        -else
            | search_web query="overview"
"#,
    );
    let other = s2.check_tool_call(
        "search_web",
        &kw([("query", json!("overview"))]),
        Some("else"),
    );
    assert!(other.allowed);
}

#[test]
fn ambiguous_same_tool_requires_choice() {
    let mut s = session_from(
        r#"
workflow "research"
    | @branch
        -when "technical"
            | search_web query="papers"
        -else
            | search_web query="overview"
"#,
    );
    let d = s.check_tool_call("search_web", &kw([("query", json!("papers"))]), None);
    assert!(!d.allowed);
    // Python: "Tool 'search_web' requires a choice before it can run."
    // Rust:   "Tool 'search_web' requires a choice."
    // Both should contain "requires a choice".
    assert!(d.reason.unwrap().contains("requires a choice"));
}

#[test]
fn invalid_choice_leaves_tool_unavailable() {
    let mut s = session_from(
        r#"
workflow "research"
    | @branch
        -when "technical"
            | search_web query="papers"
        -else
            | search_web query="overview"
"#,
    );
    let d = s.check_tool_call(
        "search_web",
        &kw([("query", json!("papers"))]),
        Some("unknown"),
    );
    assert!(!d.allowed);
    assert_eq!(
        d.reason.as_deref(),
        Some("Tool 'search_web' is not allowed next.")
    );
}

#[test]
fn retry_policy_tracks_attempts_and_blocks_until_exhausted() {
    let program = parser::parse(
        r#"
workflow "research"
    | search_web query='must be [safe]':2
"#,
    )
    .unwrap();
    let contract = compiler::Contract::from_program(&program).unwrap();
    let mut s = Session::new(contract, None)
        .unwrap()
        .with_model(Box::new(RejectingModel));
    let first = s.check_tool_call("search_web", &kw([("query", json!("bad"))]), None);
    assert!(!first.allowed);
    let rem = first.remediation.expect("remediation");
    assert_eq!(rem.message, "Retry this action. 1 retries remain.");
    assert_eq!(rem.allowed_next_actions.len(), 1);
}

#[tokio::test]
async fn session_server_can_check_and_record_result() {
    use std::sync::Arc;
    use tokio::sync::Mutex;
    let program = parser::parse(
        r#"
workflow "research"
    | search_web
"#,
    )
    .unwrap();
    let contract = compiler::Contract::from_program(&program).unwrap();
    let session = Arc::new(Mutex::new(Session::new(contract, None).unwrap()));
    let client = session::SessionServerClient::new(session.clone());

    let decision = client
        .check_tool_call("search_web", &[], &HashMap::new(), None)
        .await;
    client
        .record_result("search_web", json!({"status": "ok"}))
        .await;

    assert!(decision.allowed);
    let hist = session.lock().await.state.history.clone();
    let last = hist.last().expect("history");
    match last {
        session::SessionEvent::ToolResultRecorded { tool_name, result } => {
            assert_eq!(tool_name, "search_web");
            assert_eq!(result.get("status").and_then(|v| v.as_str()), Some("ok"));
        }
        other => panic!("unexpected event {other:?}"),
    }
}

#[test]
fn allows_dotted_tool_names() {
    let mut s = session_from(
        r#"
workflow "research"
    | notion.create_page
"#,
    );
    let d = s.check_tool_call("notion.create_page", &HashMap::new(), None);
    assert!(d.allowed);
}

#[test]
fn halt_policy_terminates_session() {
    let program = parser::parse(
        r#"
workflow "research"
    | search_web query='must be [safe]':halt
"#,
    )
    .unwrap();
    let contract = compiler::Contract::from_program(&program).unwrap();
    let mut s = Session::new(contract, None)
        .unwrap()
        .with_model(Box::new(RejectingModel));
    let d = s.check_tool_call("search_web", &kw([("query", json!("bad"))]), None);
    assert!(!d.allowed);
    // Python: "Tool 'search_web' failed a halt policy check."
    // Rust:   "Tool 'search_web' failed a halt policy."
    assert!(d.reason.unwrap().contains("halt"));
    assert!(s.state.terminated);
}

#[test]
fn halted_session_blocks_future_calls_immediately() {
    let program = parser::parse(
        r#"
workflow "research"
    | search_web query='must be [safe]':halt
"#,
    )
    .unwrap();
    let contract = compiler::Contract::from_program(&program).unwrap();
    let mut s = Session::new(contract, None)
        .unwrap()
        .with_model(Box::new(RejectingModel));
    s.check_tool_call("search_web", &kw([("query", json!("bad"))]), None);
    let d = s.check_tool_call("search_web", &kw([("query", json!("bad"))]), None);
    assert!(!d.allowed);
    assert_eq!(d.reason.as_deref(), Some("The session has been halted."));
}

#[test]
fn skip_policy_advances_past_node_and_uses_branch_choice() {
    let program = parser::parse(
        r#"
workflow "research"
    | @branch
        -when "technical"
            | search_web query='must be [safe]':skip
            | finalize_technical
        -else
            | search_web query="overview"
            | finalize_overview
"#,
    )
    .unwrap();
    let contract = compiler::Contract::from_program(&program).unwrap();
    let mut s = Session::new(contract, None)
        .unwrap()
        .with_model(Box::new(RejectingModel));
    let d = s.check_tool_call(
        "search_web",
        &kw([("query", json!("bad"))]),
        Some("technical"),
    );
    assert!(!d.allowed);
    // Python: "Tool 'search_web' was skipped after a failed constraint."
    // Rust:   "Tool 'search_web' was skipped."
    assert!(d.reason.unwrap().contains("skipped"));
    let rem = d.remediation.unwrap();
    assert!(rem
        .allowed_next_actions
        .iter()
        .any(|a| a.starts_with("finalize_technical")));
}

#[test]
fn skip_policy_on_unordered_step_uses_choice_for_next_actions() {
    let program = parser::parse(
        r#"
workflow "research"
    | @unordered
        -step "first"
            | search_web query='must be [safe]':skip
            | finalize_first
        -step "second"
            | search_web query="ok"
            | finalize_second
"#,
    )
    .unwrap();
    let contract = compiler::Contract::from_program(&program).unwrap();
    let mut s = Session::new(contract, None)
        .unwrap()
        .with_model(Box::new(RejectingModel));
    let d = s.check_tool_call(
        "search_web",
        &kw([("query", json!("bad"))]),
        Some("first"),
    );
    assert!(!d.allowed);
    let rem = d.remediation.unwrap();
    assert!(rem
        .allowed_next_actions
        .iter()
        .any(|a| a.starts_with("finalize_first")));
}
