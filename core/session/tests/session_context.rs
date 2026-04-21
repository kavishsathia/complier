//! Port of `tests/session/test_session_context.py`.
//! Session creation/memory tests port cleanly. The async context-manager
//! tests (`session.activate()` + `get_current_session()`) rely on Python's
//! `contextvars`; there's no Rust equivalent in this crate, so those are
//! marked `#[ignore]`.

use session::{Memory, Session};

fn empty_session() -> Session {
    // Rust requires a parsed contract; use a minimal one.
    let program = parser::parse("workflow \"demo\"\n    | t").expect("parse");
    let contract = compiler::Contract::from_program(&program).expect("compile");
    Session::new(contract, None).unwrap()
}

#[test]
fn contract_create_session_copies_memory_for_session_ownership() {
    let mut memory = Memory::empty();
    memory.update_check("polite", "Use a polite tone.");
    let s = empty_session().with_memory(memory.clone());
    assert_eq!(s.memory.get_check("polite"), "Use a polite tone.");
    assert!(s.state.active_workflow.is_none());
    // Rust `with_memory` takes the value by move. The Python version defensively
    // copies; in Rust we own the Memory so further mutation of `memory` would
    // be independent.
}

#[test]
fn contract_create_session_binds_integrations() {
    use session::{EvalResult, HumanEvaluator, ModelEvaluator};
    struct Stub;
    impl ModelEvaluator for Stub {
        fn evaluate(&self, _p: &str, _v: &str) -> EvalResult {
            EvalResult::pass()
        }
    }
    impl HumanEvaluator for Stub {
        fn evaluate(&self, _p: &str, _v: &str) -> EvalResult {
            EvalResult::pass()
        }
    }
    let s = empty_session()
        .with_model(Box::new(Stub))
        .with_human(Box::new(Stub));
    assert!(s.model.is_some());
    assert!(s.human.is_some());
}

#[test]
fn snapshot_memory_copies_current_memory() {
    let mut memory = Memory::empty();
    memory.update_check("polite", "Use a polite tone.");
    let s = empty_session().with_memory(memory);
    // Python has snapshot_memory(); Rust exposes Memory::clone via session.memory.
    let snapshot = s.memory.clone();
    assert_eq!(snapshot.get_check("polite"), "Use a polite tone.");
}

#[test]
fn session_memory_mutation_does_not_modify_original_memory() {
    let mut original = Memory::empty();
    original.update_check("tone", "Prefer concise answers.");
    let mut s = empty_session().with_memory(original.clone());
    s.memory.update_check("tone", "Prefer detailed answers.");
    assert_eq!(original.get_check("tone"), "Prefer concise answers.");
    assert_eq!(s.memory.get_check("tone"), "Prefer detailed answers.");
}

#[test]
fn snapshot_memory_returns_empty_when_no_memory_present() {
    let s = empty_session();
    assert!(s.memory.checks.is_empty());
}

#[test]
fn get_memory_returns_serialized_memory_string() {
    let mut memory = Memory::empty();
    memory.update_check("tone", "Prefer concise answers.");
    let s = empty_session().with_memory(memory);
    let json: serde_json::Value = serde_json::from_str(&s.memory.to_json()).unwrap();
    assert_eq!(json["checks"]["tone"], "Prefer concise answers.");
}

use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::test]
async fn activate_registers_current_session() {
    let s = empty_session();
    let s = Arc::new(Mutex::new(s));
    assert!(session::get_current_session().is_none());
    let s_for_scope = s.clone();
    session::activate_session(s.clone(), async move {
        let current = session::get_current_session().expect("current session");
        assert!(Arc::ptr_eq(&current, &s_for_scope));
    })
    .await;
    assert!(session::get_current_session().is_none());
}

#[tokio::test]
async fn nested_activation_restores_previous_session() {
    let outer = Arc::new(Mutex::new(empty_session()));
    let inner = Arc::new(Mutex::new(empty_session()));
    let outer_for_scope = outer.clone();
    let inner_for_scope = inner.clone();
    session::activate_session(outer.clone(), async move {
        let current = session::get_current_session().unwrap();
        assert!(Arc::ptr_eq(&current, &outer_for_scope));
        session::activate_session(inner.clone(), async move {
            let current = session::get_current_session().unwrap();
            assert!(Arc::ptr_eq(&current, &inner_for_scope));
        })
        .await;
        let current = session::get_current_session().unwrap();
        assert!(Arc::ptr_eq(&current, &outer_for_scope));
    })
    .await;
    assert!(session::get_current_session().is_none());
}
