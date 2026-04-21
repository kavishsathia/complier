//! Session enforcement tests. Covers the state machine behaviours that
//! govern whether a tool call is allowed, blocked, retried, skipped, or
//! halts the session.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use session::{EvalResult, HumanEvaluator, Memory, ModelEvaluator, Session, SessionEvent};

fn session_from(src: &str, workflow: Option<&str>) -> Session {
    let program = parser::parse(src).expect("parse");
    let contract = compiler::Contract::from_program(&program).expect("compile");
    Session::new(contract, workflow.map(str::to_owned)).expect("session")
}

fn kwargs<const N: usize>(pairs: [(&str, Value); N]) -> HashMap<String, Value> {
    pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect()
}

struct AlwaysPass;
impl ModelEvaluator for AlwaysPass {
    fn evaluate(&self, _p: &str, _v: &str) -> EvalResult {
        EvalResult::pass()
    }
}

struct RejectValue(&'static str);
impl ModelEvaluator for RejectValue {
    fn evaluate(&self, _p: &str, value: &str) -> EvalResult {
        if value.contains(self.0) {
            EvalResult::fail("disallowed token found")
        } else {
            EvalResult::pass()
        }
    }
}

// ── kickoff ────────────────────────────────────────────────────────────────

#[test]
fn kickoff_lists_first_action_of_single_workflow() {
    let s = session_from(
        r#"
workflow "w"
    | alpha
    | beta
"#,
        None,
    );
    let actions = s.kickoff().unwrap();
    assert_eq!(actions.len(), 1);
    assert!(actions[0].starts_with("alpha"));
}

#[test]
fn kickoff_errors_when_multiple_workflows_and_none_selected() {
    let s = session_from(
        r#"
workflow "a"
    | a_tool

workflow "b"
    | b_tool
"#,
        None,
    );
    assert!(s.kickoff().is_err());
}

#[test]
fn explicit_workflow_is_selected() {
    let s = session_from(
        r#"
workflow "a"
    | a_tool

workflow "b"
    | b_tool
"#,
        Some("b"),
    );
    let actions = s.kickoff().unwrap();
    assert_eq!(actions.len(), 1);
    assert!(actions[0].starts_with("b_tool"));
}

#[test]
fn unknown_workflow_rejected() {
    let program = parser::parse(
        r#"
workflow "only"
    | t
"#,
    )
    .unwrap();
    let contract = compiler::Contract::from_program(&program).unwrap();
    let err = match Session::new(contract, Some("missing".into())) {
        Ok(_) => panic!("expected error"),
        Err(e) => e,
    };
    assert!(err.contains("Unknown workflow"));
}

// ── ordering ───────────────────────────────────────────────────────────────

#[test]
fn out_of_order_tool_is_blocked_with_remediation() {
    let mut s = session_from(
        r#"
workflow "w"
    | first
    | second
"#,
        None,
    );
    let d = s.check_tool_call("second", &HashMap::new(), None);
    assert!(!d.allowed);
    let rem = d.remediation.expect("remediation");
    assert_eq!(rem.allowed_next_actions, vec!["first".to_string()]);
}

#[test]
fn sequential_tools_advance_after_each_allowed_call() {
    let mut s = session_from(
        r#"
workflow "w"
    | first
    | second
    | third
"#,
        None,
    );
    assert!(s.check_tool_call("first", &HashMap::new(), None).allowed);
    assert!(s.check_tool_call("second", &HashMap::new(), None).allowed);
    assert!(s.check_tool_call("third", &HashMap::new(), None).allowed);
}

// ── params & guards ────────────────────────────────────────────────────────

#[test]
fn missing_required_param_blocks() {
    let mut s = session_from(
        r#"
workflow "w"
    | search query='focused [q]'
"#,
        None,
    )
    .with_model(Box::new(AlwaysPass));
    let d = s.check_tool_call("search", &HashMap::new(), None);
    assert!(!d.allowed);
    let reasons = d.remediation.unwrap().missing_requirements;
    assert!(reasons.iter().any(|r| r.contains("Missing required param")));
}

#[test]
fn guard_failure_triggers_default_retry_policy() {
    let mut s = session_from(
        r#"
workflow "w"
    | search query='focused [q]'
"#,
        None,
    )
    .with_model(Box::new(RejectValue("bad")));
    let kw = kwargs([("query", json!("bad query"))]);
    let d = s.check_tool_call("search", &kw, None);
    assert!(!d.allowed);
    let rem = d.remediation.unwrap();
    assert!(rem.message.contains("retries remain"));
    assert_eq!(rem.allowed_next_actions, vec!["search".to_string()]);
}

#[test]
fn retry_exhaustion_halts_the_session() {
    let mut s = session_from(
        r#"
workflow "w"
    | search query='focused [q]':2
"#,
        None,
    )
    .with_model(Box::new(RejectValue("bad")));
    let kw = kwargs([("query", json!("bad query"))]);
    for _ in 0..2 {
        let d = s.check_tool_call("search", &kw, None);
        assert!(!d.allowed);
    }
    assert!(s.state.terminated, "session should be terminated");
    let d = s.check_tool_call("search", &kw, None);
    assert!(!d.allowed);
    assert_eq!(d.reason.as_deref(), Some("The session has been halted."));
}

#[test]
fn halt_policy_terminates_immediately() {
    let mut s = session_from(
        r#"
workflow "w"
    | strict query='safe [ok]':halt
"#,
        None,
    )
    .with_model(Box::new(RejectValue("nope")));
    let kw = kwargs([("query", json!("nope"))]);
    let d = s.check_tool_call("strict", &kw, None);
    assert!(!d.allowed);
    assert!(s.state.terminated);
    assert!(d.reason.unwrap().contains("halt"));
}

#[test]
fn skip_policy_advances_past_the_node() {
    let mut s = session_from(
        r#"
workflow "w"
    | optional check='ok [maybe]':skip
    | next_step
"#,
        None,
    )
    .with_model(Box::new(RejectValue("bad")));
    let kw = kwargs([("check", json!("bad value"))]);
    let d = s.check_tool_call("optional", &kw, None);
    assert!(!d.allowed);
    assert!(!s.state.terminated, "skip should not terminate");
    // next_step should now be the allowed next action
    let rem = d.remediation.unwrap();
    assert!(rem
        .allowed_next_actions
        .iter()
        .any(|a| a.starts_with("next_step")));
    // And calling next_step should succeed
    assert!(
        s.check_tool_call("next_step", &HashMap::new(), None)
            .allowed
    );
}

// ── branches ───────────────────────────────────────────────────────────────

#[test]
fn branch_without_choice_still_admits_uniquely_named_arms() {
    // If a tool name appears in only one arm, agents can speculatively call
    // it without a choice — ambiguity only kicks in when two arms share a
    // name (see `branch_requires_choice_when_arms_share_tool_name`).
    let mut s = session_from(
        r#"
workflow "w"
    | classify
    | @branch
        -when "left"
            | left_tool
        -when "right"
            | right_tool
"#,
        None,
    );
    assert!(s.check_tool_call("classify", &HashMap::new(), None).allowed);
    assert!(
        s.check_tool_call("left_tool", &HashMap::new(), None)
            .allowed
    );
}

#[test]
fn branch_requires_choice_when_arms_share_tool_name() {
    let mut s = session_from(
        r#"
workflow "w"
    | classify
    | @branch
        -when "left"
            | shared
        -when "right"
            | shared
"#,
        None,
    );
    assert!(s.check_tool_call("classify", &HashMap::new(), None).allowed);
    let d = s.check_tool_call("shared", &HashMap::new(), None);
    assert!(!d.allowed);
    assert!(d.reason.unwrap().contains("requires a choice"));
    assert!(
        s.check_tool_call("shared", &HashMap::new(), Some("left"))
            .allowed
    );
}

#[test]
fn branch_with_choice_admits_selected_arm() {
    let mut s = session_from(
        r#"
workflow "w"
    | classify
    | @branch
        -when "left"
            | left_tool
        -when "right"
            | right_tool
"#,
        None,
    );
    assert!(s.check_tool_call("classify", &HashMap::new(), None).allowed);
    assert!(
        s.check_tool_call("left_tool", &HashMap::new(), Some("left"))
            .allowed
    );
}

// ── memory & human evaluators ──────────────────────────────────────────────

struct CountingHuman {
    calls: Arc<Mutex<u32>>,
}
impl HumanEvaluator for CountingHuman {
    fn evaluate(&self, _p: &str, _v: &str) -> EvalResult {
        *self.calls.lock().unwrap() += 1;
        EvalResult::pass()
    }
}

#[test]
fn human_check_is_dispatched_to_human_evaluator() {
    let calls = Arc::new(Mutex::new(0u32));
    let mut s = session_from(
        r#"
workflow "w"
    | ask note='good {approved}'
"#,
        None,
    )
    .with_human(Box::new(CountingHuman {
        calls: calls.clone(),
    }));
    let kw = kwargs([("note", json!("hello"))]);
    let d = s.check_tool_call("ask", &kw, None);
    assert!(d.allowed, "{:?}", d);
    assert_eq!(*calls.lock().unwrap(), 1);
}

#[test]
fn learned_check_passes_when_memory_has_an_entry() {
    // Python semantics: a learned check requires BOTH a human and model
    // integration. With both configured (and both passing), the check passes
    // regardless of memory contents (memory is just fed to the model as
    // context).
    struct PassAll;
    impl ModelEvaluator for PassAll {
        fn evaluate(&self, _p: &str, _v: &str) -> EvalResult {
            EvalResult::pass()
        }
    }
    impl HumanEvaluator for PassAll {
        fn evaluate(&self, _p: &str, _v: &str) -> EvalResult {
            EvalResult::pass()
        }
    }
    let mut memory = Memory::empty();
    memory.update_check("quality_model", "trusted output");
    let mut s = session_from(
        r#"
workflow "w"
    | polish note='clean #{quality_model}'
"#,
        None,
    )
    .with_memory(memory)
    .with_model(Box::new(PassAll))
    .with_human(Box::new(PassAll));
    let kw = kwargs([("note", json!("anything"))]);
    let d = s.check_tool_call("polish", &kw, None);
    assert!(
        d.allowed,
        "learned check should pass when memory has the key, human passes, and model passes"
    );
}

#[test]
fn learned_check_fails_when_memory_is_empty() {
    let mut s = session_from(
        r#"
workflow "w"
    | polish note='clean #{quality_model}':halt
"#,
        None,
    );
    let kw = kwargs([("note", json!("anything"))]);
    let d = s.check_tool_call("polish", &kw, None);
    assert!(!d.allowed);
    assert!(d.reason.unwrap().to_lowercase().contains("halt"));
}

// ── event recording ────────────────────────────────────────────────────────

#[test]
fn record_methods_append_to_history() {
    let mut s = session_from(
        r#"
workflow "w"
    | go
"#,
        None,
    );
    s.record_allowed_call("go", kwargs([("x", json!(1))]));
    s.record_result("go", json!({"ok": true}));
    s.record_blocked_call("go", session::Decision::blocked("nope", None));
    let h = &s.state.history;
    assert_eq!(h.len(), 3);
    assert!(matches!(h[0], SessionEvent::ToolCallAllowed { .. }));
    assert!(matches!(h[1], SessionEvent::ToolResultRecorded { .. }));
    assert!(matches!(h[2], SessionEvent::ToolCallBlocked { .. }));
}

#[test]
fn memory_round_trips_through_json() {
    let mut m = Memory::empty();
    m.update_check("k", "v");
    let json = m.to_json();
    let m2 = Memory::from_source(&json).unwrap();
    assert_eq!(m2.get_check("k"), "v");
}
