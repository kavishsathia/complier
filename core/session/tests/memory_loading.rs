//! Port of `tests/memory/test_loading.py`.

use session::Memory;

#[test]
fn memory_from_source_loads_checks() {
    let m = Memory::from_source(
        r#"{"checks": {"polite": "Use a polite tone.", "concise": "Keep responses brief."}}"#,
    )
    .expect("parse");
    assert_eq!(m.get_check("polite"), "Use a polite tone.");
    assert_eq!(m.get_check("concise"), "Keep responses brief.");
}

#[test]
fn memory_from_source_returns_empty_for_blank_input() {
    let m = Memory::from_source("   ").unwrap();
    assert!(m.checks.is_empty());
}

#[test]
fn memory_from_file_and_load_alias_work() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("memory.cplm");
    std::fs::write(&path, r#"{"checks": {"polite": "Use a polite tone."}}"#).unwrap();
    let direct = Memory::from_file(&path).unwrap();
    assert_eq!(direct.get_check("polite"), "Use a polite tone.");
    // Rust has no separate `load` alias; we reuse from_file.
}

#[test]
fn memory_save_round_trips() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("memory.cplm");
    let mut m = Memory::empty();
    m.update_check("polite", "Use a polite tone.");
    m.save(&path).unwrap();
    let loaded = Memory::from_file(&path).unwrap();
    assert_eq!(loaded.get_check("polite"), "Use a polite tone.");
}

#[test]
fn memory_to_dict_and_json_serialize_expected_payload() {
    let mut m = Memory::empty();
    m.update_check("concise", "Keep responses brief.");
    m.update_check("polite", "Use a polite tone.");
    let json = m.to_json();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed["checks"]["concise"], "Keep responses brief.");
    assert_eq!(parsed["checks"]["polite"], "Use a polite tone.");
}

#[test]
fn memory_get_check_returns_empty_string_when_missing() {
    let mut m = Memory::empty();
    m.update_check("polite", "Use a polite tone.");
    assert_eq!(m.get_check("polite"), "Use a polite tone.");
    assert_eq!(m.get_check("missing"), "");
}

#[test]
fn memory_update_check_persists_learned_state() {
    let mut m = Memory::empty();
    m.update_check("tone", "Prefer concise answers.");
    assert_eq!(m.get_check("tone"), "Prefer concise answers.");
}

#[test]
fn memory_requires_json_object_payload() {
    assert!(Memory::from_source(r#"["not", "an", "object"]"#).is_err());
}

#[test]
fn memory_requires_checks_to_be_object() {
    assert!(Memory::from_source(r#"{"checks": "wrong"}"#).is_err());
}

#[test]
fn memory_requires_string_values() {
    assert!(Memory::from_source(r#"{"checks": {"polite": 3}}"#).is_err());
}

