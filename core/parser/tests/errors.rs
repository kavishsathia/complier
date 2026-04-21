//! Port of `tests/contract/test_errors.py`.
//! Python had `TypeError` / `ValueError` for None/empty; Rust has `Result<_, ParseError>`.
//! These tests assert `.is_err()` for the analogous cases.

use ast::Item;

#[test]
fn rejects_empty_source() {
    assert!(parser::parse("").is_err());
}

#[test]
fn rejects_whitespace_only_source() {
    assert!(parser::parse("   \n\t  ").is_err());
}

#[test]
fn rejects_llm_contract_attachments() {
    // Python: @llm "Summarize" [relevant:3] is rejected.
    assert!(parser::parse(
        r#"
workflow "bad"
    | @llm "Summarize" [relevant:3]
"#
    )
    .is_err());
}

#[test]
fn rejects_legacy_end_markers() {
    assert!(parser::parse(
        r#"
workflow "bad"
    | @loop
        | @human "Continue?"
        -until "yes"
    -end
"#
    )
    .is_err());
}

#[test]
fn accepts_source_without_trailing_newline() {
    let p = parser::parse("workflow \"ok\"\n    | search_web").expect("parse");
    let Item::Workflow(w) = &p.items[0] else {
        panic!()
    };
    assert_eq!(w.name, "ok");
}
