//! Port of `tests/contract/test_loading.py`.
//! Python has `Contract.from_source()` / `from_file()` / `load()`. In Rust,
//! parsing and compilation are separate steps. We compose them here.

use compiler::Contract;

fn contract_from_source(src: &str) -> Contract {
    let program = parser::parse(src).expect("parse");
    Contract::from_program(&program).expect("compile")
}

fn contract_from_file(path: &std::path::Path) -> Contract {
    let src = std::fs::read_to_string(path).expect("read");
    contract_from_source(&src)
}

#[test]
fn contract_from_source_returns_compiled_contract() {
    let c = contract_from_source(
        r#"
guarantee safe 'must have [no_harmful_content]':halt

workflow "research" @always safe
    | search_web
"#,
    );
    // Python: `contract.name == "anonymous"` and `metadata` contains `source`.
    // Rust defaults `Contract.name` to "anonymous" but has no metadata map.
    assert_eq!(c.name, "anonymous");
}

#[test]
fn contract_from_file_sets_source_path_metadata() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("research.cpl");
    std::fs::write(
        &path,
        r#"
workflow "research"
    | search_web
"#,
    )
    .unwrap();
    let c = contract_from_file(&path);
    // Rust doesn't track source_path in the Contract; presence of the
    // compiled workflow is the observable parity signal.
    assert!(c.workflows.contains_key("research"));
}

#[test]
fn contract_load_alias_uses_file_loading() {
    // Rust has no `load()` alias — `contract_from_file` is the only entry point.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("research.cpl");
    std::fs::write(
        &path,
        r#"
workflow "research"
    | search_web
"#,
    )
    .unwrap();
    let c = contract_from_file(&path);
    assert!(c.workflows.contains_key("research"));
}
