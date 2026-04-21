//! Port of `tests/session/test_kickoff.py`.
//! Python returns `kickoff()` as a newline-joined string; Rust returns Vec<String>.
//! We join with "\n" so `assertIn` behaves the same way.

use session::Session;

fn session_from(src: &str, workflow: Option<&str>) -> Session {
    let program = parser::parse(src).expect("parse");
    let contract = compiler::Contract::from_program(&program).expect("compile");
    Session::new(contract, workflow.map(str::to_owned)).expect("session")
}

fn kickoff_text(s: &Session) -> String {
    s.kickoff().expect("kickoff").join("\n")
}

// ─── KickoffTests ───────────────────────────────────────────────────────────

#[test]
fn kickoff_lists_first_tool() {
    let s = session_from(
        r#"
workflow "research"
    | search_web
"#,
        None,
    );
    assert!(kickoff_text(&s).contains("search_web"));
}

#[test]
fn kickoff_includes_param_prose() {
    let s = session_from(
        r#"
workflow "research"
    | search_web query='must return [verified sources]'
"#,
        None,
    );
    let result = kickoff_text(&s);
    assert!(result.contains("search_web"));
    assert!(result.contains("verified sources"));
    assert!(!result.contains('['));
}

#[test]
fn kickoff_includes_workflow_guard_prose() {
    let s = session_from(
        r#"
guarantee safe 'must not contain [harmful content]':halt

workflow "research" @always safe
    | search_web
"#,
        None,
    );
    let result = kickoff_text(&s);
    assert!(result.contains("search_web"));
    assert!(result.contains("harmful content"));
    assert!(!result.contains('['));
}

#[test]
fn kickoff_lists_all_branch_arms() {
    let s = session_from(
        r#"
workflow "research"
    | @branch
        -when "morning"
            | search_web
        -when "evening"
            | read_cache
"#,
        None,
    );
    let r = kickoff_text(&s);
    assert!(r.contains("search_web"));
    assert!(r.contains("read_cache"));
}

#[test]
fn kickoff_includes_choice_label_for_branch() {
    let s = session_from(
        r#"
workflow "research"
    | @branch
        -when "morning"
            | search_web
        -when "evening"
            | read_cache
"#,
        None,
    );
    let r = kickoff_text(&s);
    assert!(r.contains("morning"));
    assert!(r.contains("evening"));
}

#[test]
fn kickoff_raises_when_multiple_workflows_and_none_selected() {
    let s = session_from(
        r#"
workflow "research"
    | search_web

workflow "publish"
    | publish_post
"#,
        None,
    );
    assert!(s.kickoff().is_err());
}

#[test]
fn kickoff_works_when_workflow_preselected() {
    let s = session_from(
        r#"
workflow "research"
    | search_web

workflow "publish"
    | publish_post
"#,
        Some("research"),
    );
    let r = kickoff_text(&s);
    assert!(r.contains("search_web"));
    assert!(!r.contains("publish_post"));
}

// ─── WorkflowSelectionTests ─────────────────────────────────────────────────

#[test]
fn workflow_param_sets_active_workflow() {
    let s = session_from(
        r#"
workflow "research"
    | search_web

workflow "publish"
    | publish_post
"#,
        Some("research"),
    );
    assert_eq!(s.state.active_workflow.as_deref(), Some("research"));
}

#[test]
fn unknown_workflow_raises_on_creation() {
    let program = parser::parse(
        r#"
workflow "research"
    | search_web
"#,
    )
    .unwrap();
    let contract = compiler::Contract::from_program(&program).unwrap();
    assert!(Session::new(contract, Some("nonexistent".into())).is_err());
}

#[test]
fn single_workflow_needs_no_selection() {
    let s = session_from(
        r#"
workflow "research"
    | search_web
"#,
        None,
    );
    assert!(kickoff_text(&s).contains("search_web"));
}

// ─── CustomFormatterTests ────────────────────────────────────────────────────

use std::sync::{Arc, Mutex};

fn session_with_formatter(src: &str, rec: Arc<Mutex<Vec<session::NextActions>>>) -> Session {
    let program = parser::parse(src).expect("parse");
    let contract = compiler::Contract::from_program(&program).expect("compile");
    let rec = rec.clone();
    Session::new(contract, None).unwrap().with_formatter(Box::new(
        move |next: &session::NextActions| -> Vec<String> {
            rec.lock().unwrap().push(next.clone());
            next.actions
                .iter()
                .map(|d| format!("do: {}", d.tool_name))
                .collect()
        },
    ))
}

#[test]
fn custom_formatter_receives_next_actions_struct() {
    let received: Arc<Mutex<Vec<session::NextActions>>> = Arc::new(Mutex::new(vec![]));
    let s = session_with_formatter(
        r#"
workflow "research"
    | search_web
"#,
        received.clone(),
    );
    let result = s.kickoff().expect("kickoff").join("\n");
    let got = received.lock().unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(result, "do: search_web");
}

#[test]
fn custom_formatter_receives_is_branch_possible() {
    let received: Arc<Mutex<Vec<session::NextActions>>> = Arc::new(Mutex::new(vec![]));
    let s = session_with_formatter(
        r#"
workflow "research"
    | @branch
        -when "a"
            | search_web
        -when "b"
            | read_cache
"#,
        received.clone(),
    );
    let _ = s.kickoff();
    let got = received.lock().unwrap();
    assert!(got[0].is_branch_possible);
    assert!(!got[0].is_unordered_possible);
}

#[test]
fn custom_formatter_receives_is_unordered_possible() {
    let received: Arc<Mutex<Vec<session::NextActions>>> = Arc::new(Mutex::new(vec![]));
    let s = session_with_formatter(
        r#"
workflow "research"
    | @unordered
        -step "fetch"
            | search_web
        -step "cache"
            | read_cache
"#,
        received.clone(),
    );
    let _ = s.kickoff();
    let got = received.lock().unwrap();
    assert!(!got[0].is_branch_possible);
    assert!(got[0].is_unordered_possible);
}

#[test]
fn custom_formatter_descriptor_has_choice_label() {
    let received: Arc<Mutex<Vec<session::NextActions>>> = Arc::new(Mutex::new(vec![]));
    let s = session_with_formatter(
        r#"
workflow "research"
    | @branch
        -when "morning"
            | search_web
"#,
        received.clone(),
    );
    let _ = s.kickoff();
    let got = received.lock().unwrap();
    let desc = &got[0].actions[0];
    assert_eq!(desc.tool_name, "search_web");
    assert_eq!(desc.choice_label.as_deref(), Some("morning"));
}
