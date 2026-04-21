//! Parser grammar tests. Exercise each top-level construct (guarantees,
//! workflows) and each step kind (tool, human, llm, branch, loop, unordered,
//! call/fork/join) plus prose-guard policy suffixes.

use ast::{Check, ElseArm, Item, ParamValue, Policy, Step};

fn parse(src: &str) -> ast::Program {
    parser::parse(src).expect("parse")
}

#[test]
fn guarantee_is_recognized_as_top_level_item() {
    let p = parse(
        r#"
guarantee safe 'no harmful content {safe}'
"#,
    );
    assert_eq!(p.items.len(), 1);
    let Item::Guarantee(g) = &p.items[0] else {
        panic!()
    };
    assert_eq!(g.name, "safe");
    assert!(g.expression.prose.contains("no harmful content"));
    // `{safe}` is a HumanCheck
    assert!(matches!(g.expression.checks[0], Check::Human(_)));
}

#[test]
fn always_references_attach_to_workflow() {
    let p = parse(
        r#"
guarantee safe 'x'
guarantee cited 'y'

workflow "w"
    @always safe
    @always cited
    | t
"#,
    );
    let Item::Workflow(w) = p
        .items
        .iter()
        .find(|i| matches!(i, Item::Workflow(_)))
        .unwrap()
    else {
        unreachable!()
    };
    assert_eq!(w.always, vec!["safe".to_string(), "cited".to_string()]);
}

#[test]
fn tool_step_with_string_and_int_and_bool_params() {
    let p = parse(
        r#"
workflow "w"
    | tool a="hello" b=42 c=true d=false e=null
"#,
    );
    let Item::Workflow(w) = &p.items[0] else {
        panic!()
    };
    let Step::Tool(t) = &w.steps[0] else { panic!() };
    let by: std::collections::HashMap<_, _> = t
        .params
        .iter()
        .map(|p| (p.name.clone(), p.value.clone()))
        .collect();
    assert_eq!(by["a"], ParamValue::String("hello".into()));
    assert_eq!(by["b"], ParamValue::Int(42));
    assert_eq!(by["c"], ParamValue::Bool(true));
    assert_eq!(by["d"], ParamValue::Bool(false));
    assert_eq!(by["e"], ParamValue::Null);
}

#[test]
fn prose_param_produces_guard_with_all_check_kinds() {
    let p = parse(
        r#"
workflow "w"
    | t input='good [model] {human} #{learned}'
"#,
    );
    let Item::Workflow(w) = &p.items[0] else {
        panic!()
    };
    let Step::Tool(t) = &w.steps[0] else { panic!() };
    let ParamValue::Guard(g) = &t.params[0].value else {
        panic!()
    };
    let kinds: Vec<_> = g
        .checks
        .iter()
        .map(|c| match c {
            Check::Model(_) => "model",
            Check::Human(_) => "human",
            Check::Learned(_) => "learned",
        })
        .collect();
    assert!(kinds.contains(&"model"));
    assert!(kinds.contains(&"human"));
    assert!(kinds.contains(&"learned"));
}

#[test]
fn guard_policy_halt_and_skip_and_retry() {
    let p = parse(
        r#"
workflow "w"
    | a p='x [c]':halt
    | b p='y [c]':skip
    | c p='z [c]':5
"#,
    );
    let Item::Workflow(w) = &p.items[0] else {
        panic!()
    };
    let policies: Vec<Policy> = w
        .steps
        .iter()
        .map(|s| match s {
            Step::Tool(t) => match &t.params[0].value {
                ParamValue::Guard(g) => g.policy.clone(),
                _ => panic!(),
            },
            _ => panic!(),
        })
        .collect();
    assert!(matches!(policies[0], Policy::Halt));
    assert!(matches!(policies[1], Policy::Skip));
    assert!(matches!(policies[2], Policy::Retry(ref r) if r.attempts == 5));
}

#[test]
fn human_and_llm_steps_carry_prompts() {
    let p = parse(
        r#"
workflow "w"
    | @human "ask for topic"
    | @llm "classify input"
"#,
    );
    let Item::Workflow(w) = &p.items[0] else {
        panic!()
    };
    let Step::Human(h) = &w.steps[0] else {
        panic!()
    };
    assert_eq!(h.prompt, "ask for topic");
    let Step::Llm(l) = &w.steps[1] else { panic!() };
    assert_eq!(l.prompt, "classify input");
}

#[test]
fn branch_with_when_and_else_arms() {
    let p = parse(
        r#"
workflow "w"
    | @branch
        -when "tech"
            | write_tech
        -when "general"
            | write_general
        -else
            | write_overview
"#,
    );
    let Item::Workflow(w) = &p.items[0] else {
        panic!()
    };
    let Step::Branch(b) = &w.steps[0] else {
        panic!()
    };
    let conditions: Vec<_> = b.when_arms.iter().map(|a| a.condition.clone()).collect();
    assert_eq!(conditions, vec!["tech".to_string(), "general".to_string()]);
    assert!(matches!(b.else_arm, Some(ElseArm { .. })));
}

#[test]
fn loop_step_parses_until_label() {
    let p = parse(
        r#"
workflow "w"
    | @loop
        | ask
        -until "yes"
"#,
    );
    let Item::Workflow(w) = &p.items[0] else {
        panic!()
    };
    let Step::Loop(l) = &w.steps[0] else { panic!() };
    assert_eq!(l.until, "yes");
    assert_eq!(l.steps.len(), 1);
}

#[test]
fn unordered_step_parses_cases() {
    let p = parse(
        r#"
workflow "w"
    | @unordered
        -step "a"
            | run_a
        -step "b"
            | run_b
"#,
    );
    let Item::Workflow(w) = &p.items[0] else {
        panic!()
    };
    let Step::Unordered(u) = &w.steps[0] else {
        panic!()
    };
    let labels: Vec<_> = u.cases.iter().map(|c| c.label.clone()).collect();
    assert_eq!(labels, vec!["a".to_string(), "b".to_string()]);
}

#[test]
fn call_and_fork_and_join_steps() {
    let p = parse(
        r#"
workflow "w"
    | @call sub
    | @fork refs @call verify
    | @join refs
"#,
    );
    let Item::Workflow(w) = &p.items[0] else {
        panic!()
    };
    assert!(matches!(w.steps[0], Step::Subworkflow(_)));
    assert!(matches!(w.steps[1], Step::Fork(_)));
    assert!(matches!(w.steps[2], Step::Join(_)));
}

#[test]
fn malformed_input_is_rejected() {
    // missing workflow name
    assert!(parser::parse("workflow\n    | t").is_err());
    // stray token at top level
    assert!(parser::parse("| t").is_err());
}
