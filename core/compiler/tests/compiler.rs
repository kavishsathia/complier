//! Port of `tests/contract/test_compiler.py`.

use ast::{Check, ParamValue, Policy};
use compiler::Contract;
use runtime::{BranchMode, RuntimeNode};

fn contract_from_source(src: &str) -> Contract {
    let program = parser::parse(src).expect("parse");
    Contract::from_program(&program).expect("compile")
}

#[test]
fn compiles_workflow_with_start_and_end_nodes() {
    let c = contract_from_source(
        r#"
workflow "research"
    | search_web
"#,
    );
    let w = &c.workflows["research"];
    assert!(matches!(&w.nodes[&w.start_node_id], RuntimeNode::Start(_)));
    assert!(matches!(&w.nodes[&w.end_node_id], RuntimeNode::End(_)));
}

#[test]
fn inlines_always_guarantees_into_executable_nodes() {
    let c = contract_from_source(
        r#"
guarantee safe 'must have [no_harmful_content]':halt

workflow "research" @always safe
    | search_web
"#,
    );
    let w = &c.workflows["research"];
    let start = match &w.nodes[&w.start_node_id] {
        RuntimeNode::Start(s) => s,
        _ => panic!(),
    };
    let tool_id = &start.next_ids[0];
    let RuntimeNode::Tool(t) = &w.nodes[tool_id] else {
        panic!("expected ToolNode")
    };
    assert_eq!(t.guards.len(), 1);
    assert!(matches!(t.guards[0].policy, Policy::Halt));
    let Check::Model(m) = &t.guards[0].checks[0] else {
        panic!()
    };
    assert_eq!(m.name, "no_harmful_content");
}

#[test]
fn inlines_guarantee_references_inside_param_expressions() {
    let c = contract_from_source(
        r#"
workflow "research"
    | review gate='must be [no_harmful_content] and [relevant]':2
"#,
    );
    let w = &c.workflows["research"];
    let start = match &w.nodes[&w.start_node_id] {
        RuntimeNode::Start(s) => s,
        _ => panic!(),
    };
    let RuntimeNode::Tool(t) = &w.nodes[&start.next_ids[0]] else {
        panic!()
    };
    let ParamValue::Guard(g) = &t.params["gate"] else {
        panic!("gate should be a prose guard")
    };
    let Policy::Retry(r) = &g.policy else {
        panic!()
    };
    assert_eq!(r.attempts, 2);
    assert_eq!(g.checks.len(), 2);
    assert!(matches!(g.checks[0], Check::Model(_)));
    assert!(matches!(g.checks[1], Check::Model(_)));
}

#[test]
fn compiles_branch_and_unordered_control_flow_nodes() {
    let c = contract_from_source(
        r#"
workflow "research"
    | @branch
        -when "technical"
            | detailed_review
        -else
            | overview
    | @unordered
        -step "first"
            | first_step
        -step "second"
            | second_step
"#,
    );
    let w = &c.workflows["research"];
    let has = |f: fn(&RuntimeNode) -> bool| w.nodes.values().any(f);
    assert!(has(|n| matches!(n, RuntimeNode::Branch(b) if b.mode == BranchMode::Branch)));
    assert!(has(|n| matches!(n, RuntimeNode::BranchBack(_))));
    assert!(has(|n| matches!(n, RuntimeNode::Unordered(_))));
    assert!(has(|n| matches!(n, RuntimeNode::UnorderedBack(_))));
}

#[test]
fn compiles_loops_as_branch_exit_plus_else_body() {
    let c = contract_from_source(
        r#"
workflow "review"
    | @loop
        | ask_human
        -until "yes"
"#,
    );
    let w = &c.workflows["review"];
    let loop_branch = w
        .nodes
        .values()
        .find_map(|n| match n {
            RuntimeNode::Branch(b) if b.mode == BranchMode::Loop => Some(b),
            _ => None,
        })
        .expect("loop branch");
    let back_id = loop_branch.branch_back_id.as_ref().unwrap();
    assert!(matches!(&w.nodes[back_id], RuntimeNode::BranchBack(_)));
    assert_eq!(&loop_branch.arms["yes"], back_id);
    let else_id = loop_branch.else_node_id.as_ref().unwrap();
    let RuntimeNode::Tool(body) = &w.nodes[else_id] else {
        panic!()
    };
    assert_eq!(body.tool_name, "ask_human");
    assert_eq!(body.next_ids, vec![loop_branch.id.clone()]);
}

#[test]
fn compiles_multiple_workflows_in_one_contract() {
    let c = contract_from_source(
        r#"
workflow "research"
    | search_web

workflow "publish"
    | publish_post
"#,
    );
    let names: std::collections::HashSet<_> = c.workflows.keys().cloned().collect();
    let expected: std::collections::HashSet<_> =
        ["research", "publish"].iter().map(|s| s.to_string()).collect();
    assert_eq!(names, expected);
    assert_ne!(
        c.workflows["research"].start_node_id,
        c.workflows["publish"].start_node_id
    );
}

#[test]
fn compiles_subworkflow_fork_and_join_nodes() {
    let c = contract_from_source(
        r#"
workflow "research"
    | @call gather_sources
    | @fork refs @call verify_sources
    | @join refs
"#,
    );
    let w = &c.workflows["research"];
    let call = w
        .nodes
        .values()
        .find_map(|n| if let RuntimeNode::Call(c) = n { Some(c) } else { None })
        .expect("call");
    let fork = w
        .nodes
        .values()
        .find_map(|n| if let RuntimeNode::Fork(f) = n { Some(f) } else { None })
        .expect("fork");
    let join = w
        .nodes
        .values()
        .find_map(|n| if let RuntimeNode::Join(j) = n { Some(j) } else { None })
        .expect("join");
    assert_eq!(call.call_type, "@call");
    assert_eq!(call.workflow_name, "gather_sources");
    assert_eq!(fork.fork_id, "refs");
    assert_eq!(fork.call_type, "@call");
    assert_eq!(fork.workflow_name, "verify_sources");
    assert_eq!(join.fork_id, "refs");
}

#[test]
fn keeps_linear_step_order_through_mixed_node_types() {
    let c = contract_from_source(
        r#"
workflow "research"
    | @human "What topic?"
    | @llm "Classify"
    | search_web
"#,
    );
    let w = &c.workflows["research"];
    let start = match &w.nodes[&w.start_node_id] {
        RuntimeNode::Start(s) => s,
        _ => panic!(),
    };
    let first = &w.nodes[&start.next_ids[0]];
    assert!(matches!(first, RuntimeNode::Human(_)));
    let second = &w.nodes[&first.next_ids()[0]];
    assert!(matches!(second, RuntimeNode::Llm(_)));
    let third = &w.nodes[&second.next_ids()[0]];
    assert!(matches!(third, RuntimeNode::Tool(_)));
    let end = &w.nodes[&third.next_ids()[0]];
    assert!(matches!(end, RuntimeNode::End(_)));
}

#[test]
fn branch_back_reconnects_to_following_step() {
    let c = contract_from_source(
        r#"
workflow "research"
    | @branch
        -when "technical"
            | detailed_review
        -else
            | overview
    | finalize
"#,
    );
    let w = &c.workflows["research"];
    let back = w
        .nodes
        .values()
        .find_map(|n| {
            if let RuntimeNode::BranchBack(bb) = n {
                Some(bb)
            } else {
                None
            }
        })
        .expect("branch_back");
    let RuntimeNode::Tool(next) = &w.nodes[&back.next_ids[0]] else {
        panic!()
    };
    assert_eq!(next.tool_name, "finalize");
}

#[test]
fn unordered_back_reconnects_to_following_step() {
    let c = contract_from_source(
        r#"
workflow "research"
    | @unordered
        -step "first"
            | first_step
        -step "second"
            | second_step
    | finalize
"#,
    );
    let w = &c.workflows["research"];
    let back = w
        .nodes
        .values()
        .find_map(|n| {
            if let RuntimeNode::UnorderedBack(ub) = n {
                Some(ub)
            } else {
                None
            }
        })
        .expect("unordered_back");
    let RuntimeNode::Tool(next) = &w.nodes[&back.next_ids[0]] else {
        panic!()
    };
    assert_eq!(next.tool_name, "finalize");
}

#[test]
fn inlines_nested_guarantee_references_globally() {
    let c = contract_from_source(
        r#"
guarantee reviewed '[no_harmful_content] and [quality]':2

workflow "research"
    | publish
"#,
    );
    let g = c.guarantees.get("reviewed").expect("guarantee");
    let Policy::Retry(r) = &g.policy else {
        panic!()
    };
    assert_eq!(r.attempts, 2);
    assert_eq!(g.checks.len(), 2);
    assert!(matches!(g.checks[0], Check::Model(_)));
    assert!(matches!(g.checks[1], Check::Model(_)));
}

#[test]
fn applies_inherited_guards_to_all_executable_step_types() {
    let c = contract_from_source(
        r#"
guarantee safe 'must have [no_harmful_content]':halt

workflow "research" @always safe
    | @human "What topic?"
    | @llm "Classify"
    | search_web
    | @call gather_sources
    | @fork refs @call verify_sources
    | @join refs
"#,
    );
    let w = &c.workflows["research"];
    let mut seen_any = false;
    for n in w.nodes.values() {
        let guards = match n {
            RuntimeNode::Human(x) => Some(&x.guards),
            RuntimeNode::Llm(x) => Some(&x.guards),
            RuntimeNode::Tool(x) => Some(&x.guards),
            RuntimeNode::Call(x) => Some(&x.guards),
            RuntimeNode::Fork(x) => Some(&x.guards),
            RuntimeNode::Join(x) => Some(&x.guards),
            _ => None,
        };
        if let Some(gs) = guards {
            seen_any = true;
            assert_eq!(gs.len(), 1);
            assert!(matches!(gs[0].policy, Policy::Halt));
            let Check::Model(m) = &gs[0].checks[0] else {
                panic!()
            };
            assert_eq!(m.name, "no_harmful_content");
        }
    }
    assert!(seen_any);
}

#[test]
fn compiled_workflow_node_ids_are_unique() {
    let c = contract_from_source(
        r#"
workflow "research"
    | @human "What topic?"
    | @branch
        -when "technical"
            | detailed_review
        -else
            | overview
    | @unordered
        -step "first"
            | first_step
        -step "second"
            | second_step
    | finalize
"#,
    );
    let w = &c.workflows["research"];
    let ids: std::collections::HashSet<_> = w.nodes.keys().cloned().collect();
    assert_eq!(ids.len(), w.nodes.len());
}

// --- Python-specific tests that don't translate ---
// - test_workflow_compiler_rejects_unknown_step_type: tests duck-typed `object()`.
//   Rust's typed `Step` enum makes this impossible by construction.
// - test_contract_compiler_rejects_non_parsed_contract_input: same, Rust is typed.
// - test_contract_compiler_rejects_missing_program_ast: ditto.
