//! Port of `tests/contract/test_steps.py`.

use ast::{Item, Step};

fn parse_program(src: &str) -> ast::Program {
    parser::parse(src).expect("parse")
}

#[test]
fn parses_basic_inline_steps() {
    let program = parse_program(
        r#"
workflow "ops" @always safe @always approved
    | @human "What happened?"
    | @llm "Summarize incident"
    | search_logs
    | @call triage
    | @fork refs @call collect_refs
    | @join refs
"#,
    );
    let Item::Workflow(w) = &program.items[0] else {
        panic!()
    };
    assert_eq!(w.name, "ops");
    assert_eq!(w.always, vec!["safe".to_string(), "approved".to_string()]);
    assert!(matches!(w.steps[0], Step::Human(_)));
    assert!(matches!(w.steps[1], Step::Llm(_)));
    assert!(matches!(w.steps[2], Step::Tool(_)));
    assert!(matches!(w.steps[3], Step::Subworkflow(_)));
    assert!(matches!(w.steps[4], Step::Fork(_)));
    assert!(matches!(w.steps[5], Step::Join(_)));
}

#[test]
fn parses_use_inline_and_fork_join_details() {
    let program = parse_program(
        r#"
workflow "ops"
    | @use triage
    | @inline summarize
    | @fork refs @inline collect_refs
    | @join refs
"#,
    );
    let Item::Workflow(w) = &program.items[0] else {
        panic!()
    };
    let Step::Subworkflow(s0) = &w.steps[0] else {
        panic!()
    };
    assert_eq!(s0.call_type, "@use");
    assert_eq!(s0.workflow_name, "triage");

    let Step::Subworkflow(s1) = &w.steps[1] else {
        panic!()
    };
    assert_eq!(s1.call_type, "@inline");
    assert_eq!(s1.workflow_name, "summarize");

    let Step::Fork(f) = &w.steps[2] else { panic!() };
    assert_eq!(f.fork_id, "refs");
    assert_eq!(f.target.call_type, "@inline");
    assert_eq!(f.target.workflow_name, "collect_refs");

    let Step::Join(j) = &w.steps[3] else { panic!() };
    assert_eq!(j.fork_id, "refs");
}

#[test]
fn parses_branch_loop_and_unordered_blocks() {
    let program = parse_program(
        r#"
workflow "research"
    | @branch
        -when "technical"
            | @llm "Write detailed analysis"
            | @loop
                | @human "Continue?"
                -until "yes"
        -else
            | @llm "Write overview"
    | @unordered
        -step "format citations"
            | format_citations
        -step "generate bibliography"
            | generate_bibliography
"#,
    );
    let Item::Workflow(w) = &program.items[0] else {
        panic!()
    };
    assert!(matches!(w.steps[0], Step::Branch(_)));
    assert!(matches!(w.steps[1], Step::Unordered(_)));

    let Step::Branch(b) = &w.steps[0] else { panic!() };
    assert_eq!(b.when_arms.len(), 1);
    assert_eq!(b.when_arms[0].condition, "technical");
    assert!(matches!(b.when_arms[0].steps[0], Step::Llm(_)));
    let Step::Loop(lp) = &b.when_arms[0].steps[1] else {
        panic!()
    };
    assert_eq!(lp.until, "yes");
    assert!(b.else_arm.is_some());
    let else_arm = b.else_arm.as_ref().unwrap();
    assert!(matches!(else_arm.steps[0], Step::Llm(_)));

    let Step::Unordered(u) = &w.steps[1] else {
        panic!()
    };
    assert_eq!(u.cases.len(), 2);
    assert_eq!(u.cases[0].label, "format citations");
    assert!(matches!(u.cases[0].steps[0], Step::Tool(_)));
    assert_eq!(u.cases[1].label, "generate bibliography");
}

#[test]
fn preserves_unordered_case_labels_and_steps() {
    let program = parse_program(
        r#"
workflow "research"
    | @unordered
        -step "first pass"
            | collect_sources
        -step "fact check"
            | verify_sources
"#,
    );
    let Item::Workflow(w) = &program.items[0] else {
        panic!()
    };
    let Step::Unordered(u) = &w.steps[0] else {
        panic!()
    };
    let labels: Vec<_> = u.cases.iter().map(|c| c.label.clone()).collect();
    assert_eq!(labels, vec!["first pass".to_string(), "fact check".to_string()]);
    let Step::Tool(t0) = &u.cases[0].steps[0] else {
        panic!()
    };
    assert_eq!(t0.name, "collect_sources");
    let Step::Tool(t1) = &u.cases[1].steps[0] else {
        panic!()
    };
    assert_eq!(t1.name, "verify_sources");
}
