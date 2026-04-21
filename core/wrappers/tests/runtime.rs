//! Port of `tests/test_runtime_and_errors.py`.

use serde_json::{Map, Value};
use session::{BlockedToolCall, Decision, RuntimeEvent, StructuredMessage};

#[test]
fn blocked_tool_call_stringifies_with_tool_name() {
    let err = BlockedToolCall::new("search_web", Decision::blocked("nope", None));
    assert_eq!(
        err.to_string(),
        "Tool 'search_web' was blocked by the active contract."
    );
}

#[test]
fn runtime_event_stores_name_and_payload() {
    let mut payload: Map<String, Value> = Map::new();
    payload.insert("tool_name".into(), Value::String("search_web".into()));
    let ev = RuntimeEvent::new("tool_call_allowed", payload.clone());
    assert_eq!(ev.name, "tool_call_allowed");
    assert_eq!(ev.payload, payload);
}

#[test]
fn structured_message_defaults_optional_lists() {
    let m = StructuredMessage::new("Blocked action");
    assert_eq!(m.summary, "Blocked action");
    assert_eq!(m.details, Vec::<String>::new());
    assert_eq!(m.allowed_next_actions, Vec::<String>::new());
}
