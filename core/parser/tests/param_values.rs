//! Port of `tests/contract/test_param_values.py`.

use ast::{Item, ParamValue, Policy, Step};

fn parse_program(src: &str) -> ast::Program {
    parser::parse(src).expect("parse")
}

#[test]
fn parses_scalar_param_values() {
    let program = parse_program(
        r#"
workflow "params"
    | tool text="hello" count=3 enabled=true disabled=false reviewer=null
"#,
    );
    let Item::Workflow(w) = &program.items[0] else {
        panic!()
    };
    let Step::Tool(t) = &w.steps[0] else { panic!() };
    let by: std::collections::HashMap<_, _> = t
        .params
        .iter()
        .map(|p| (p.name.clone(), p.value.clone()))
        .collect();
    assert_eq!(by["text"], ParamValue::String("hello".into()));
    assert_eq!(by["count"], ParamValue::Int(3));
    assert_eq!(by["enabled"], ParamValue::Bool(true));
    assert_eq!(by["disabled"], ParamValue::Bool(false));
    assert_eq!(by["reviewer"], ParamValue::Null);
}

#[test]
fn parses_prose_guard_as_param_value() {
    let program = parse_program(
        r#"
workflow "checks"
    | classify gate='must be [relevant] and [concise]':halt
"#,
    );
    let Item::Workflow(w) = &program.items[0] else {
        panic!()
    };
    let Step::Tool(t) = &w.steps[0] else { panic!() };
    assert_eq!(t.params.len(), 1);
    let gate = &t.params[0];
    assert_eq!(gate.name, "gate");
    let ParamValue::Guard(g) = &gate.value else {
        panic!()
    };
    assert!(matches!(g.policy, Policy::Halt));
    assert_eq!(g.checks.len(), 2);
    let ast::Check::Model(c0) = &g.checks[0] else {
        panic!()
    };
    let ast::Check::Model(c1) = &g.checks[1] else {
        panic!()
    };
    assert_eq!(c0.name, "relevant");
    assert_eq!(c1.name, "concise");
}

#[test]
fn prose_guards_default_to_retry_three_policy() {
    let program = parse_program(
        r#"
workflow "checks"
    | classify gate='must be [relevant]'
"#,
    );
    let Item::Workflow(w) = &program.items[0] else {
        panic!()
    };
    let Step::Tool(t) = &w.steps[0] else { panic!() };
    let ParamValue::Guard(g) = &t.params[0].value else {
        panic!()
    };
    let Policy::Retry(r) = &g.policy else {
        panic!("expected default retry(3)")
    };
    assert_eq!(r.attempts, 3);
}

#[test]
fn public_parser_round_trips_scalar_param_values_without_trailing_newline() {
    let program = parser::parse(
        "workflow \"params\"\n    | tool count=3 enabled=true disabled=false reviewer=null",
    )
    .expect("parse");
    let Item::Workflow(w) = &program.items[0] else {
        panic!()
    };
    let Step::Tool(t) = &w.steps[0] else { panic!() };
    let by: std::collections::HashMap<_, _> = t
        .params
        .iter()
        .map(|p| (p.name.clone(), p.value.clone()))
        .collect();
    assert_eq!(by["count"], ParamValue::Int(3));
    assert_eq!(by["enabled"], ParamValue::Bool(true));
    assert_eq!(by["disabled"], ParamValue::Bool(false));
    assert_eq!(by["reviewer"], ParamValue::Null);
}
