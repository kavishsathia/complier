//! Port of `tests/contract/test_guarantees.py`.

use ast::{Check, Item, Policy};

fn parse_program(src: &str) -> ast::Program {
    parser::parse(src).expect("parse")
}

#[test]
fn parses_multiple_guarantee_check_kinds() {
    let program = parse_program(
        r#"
guarantee safe '[no_harmful_content]':halt
guarantee approved '{editor_signed_off}':skip
guarantee quality '#{quality_model}':3
"#,
    );

    assert_eq!(program.items.len(), 3);
    let Item::Guarantee(g0) = &program.items[0] else {
        panic!()
    };
    let Item::Guarantee(g1) = &program.items[1] else {
        panic!()
    };
    let Item::Guarantee(g2) = &program.items[2] else {
        panic!()
    };

    assert_eq!(g0.name, "safe");
    assert_eq!(g1.name, "approved");
    assert_eq!(g2.name, "quality");

    let Check::Model(m) = &g0.expression.checks[0] else {
        panic!()
    };
    assert_eq!(m.name, "no_harmful_content");
    assert!(matches!(g0.expression.policy, Policy::Halt));

    let Check::Human(h) = &g1.expression.checks[0] else {
        panic!()
    };
    assert_eq!(h.name, "editor_signed_off");
    assert!(matches!(g1.expression.policy, Policy::Skip));

    let Check::Learned(l) = &g2.expression.checks[0] else {
        panic!()
    };
    assert_eq!(l.name, "quality_model");
    let Policy::Retry(r) = &g2.expression.policy else {
        panic!()
    };
    assert_eq!(r.attempts, 3);
}

#[test]
fn parses_mixed_check_kinds_in_prose() {
    let program = parse_program(
        r#"
guarantee gate 'must be [relevant] and {approved} and #{tone}':3
"#,
    );
    let Item::Guarantee(g) = &program.items[0] else {
        panic!()
    };
    let Policy::Retry(r) = &g.expression.policy else {
        panic!()
    };
    assert_eq!(r.attempts, 3);
    assert_eq!(g.expression.checks.len(), 3);
    assert!(matches!(g.expression.checks[0], Check::Model(_)));
    assert!(matches!(g.expression.checks[1], Check::Human(_)));
    assert!(matches!(g.expression.checks[2], Check::Learned(_)));
}

#[test]
fn parses_prose_guard_without_policy_defaults_to_retry_3() {
    let program = parse_program(
        r#"
guarantee safe 'must be [no_harmful_content]'
"#,
    );
    let Item::Guarantee(g) = &program.items[0] else {
        panic!()
    };
    let Policy::Retry(r) = &g.expression.policy else {
        panic!("expected default retry(3), got {:?}", g.expression.policy)
    };
    assert_eq!(r.attempts, 3);
}

#[test]
fn parses_halt_and_skip_policies() {
    let program = parse_program(
        r#"
guarantee a '[check_a]':halt
guarantee b '[check_b]':skip
"#,
    );
    let Item::Guarantee(a) = &program.items[0] else {
        panic!()
    };
    let Item::Guarantee(b) = &program.items[1] else {
        panic!()
    };
    assert!(matches!(a.expression.policy, Policy::Halt));
    assert!(matches!(b.expression.policy, Policy::Skip));
}
