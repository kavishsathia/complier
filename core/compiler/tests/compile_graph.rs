//! Compiler graph-structure tests. Ensure the AST → RuntimeNode graph has
//! the right shape for branches, loops, unordered blocks, guarantees, and
//! error paths.

use compiler::{CompileError, Contract};
use runtime::{BranchMode, RuntimeNode};

fn compile(src: &str) -> Result<Contract, CompileError> {
    let program = parser::parse(src).expect("parse");
    Contract::from_program(&program)
}

#[test]
fn always_guarantee_is_inherited_onto_tool_nodes() {
    let src = r#"
guarantee safe 'no harmful content {safe}'

workflow "w"
    @always safe
    | step_one
    | step_two
"#;
    let c = compile(src).unwrap();
    let w = &c.workflows["w"];
    let tool_count = w
        .nodes
        .values()
        .filter(|n| matches!(n, RuntimeNode::Tool(_)))
        .count();
    assert_eq!(tool_count, 2);
    for n in w.nodes.values() {
        if let RuntimeNode::Tool(t) = n {
            assert_eq!(
                t.guards.len(),
                1,
                "tool {} missing @always guard",
                t.tool_name
            );
            assert!(t.guards[0].prose.contains("no harmful content"));
        }
    }
}

#[test]
fn unknown_guarantee_errors() {
    let src = r#"
workflow "w"
    @always nope
    | t
"#;
    let err = compile(src).unwrap_err();
    assert!(matches!(err, CompileError::UnknownGuarantee(ref n) if n == "nope"));
}

#[test]
fn branch_has_arms_and_else_and_back_node() {
    let src = r#"
workflow "w"
    | classify
    | @branch
        -when "tech"
            | write_tech
        -when "general"
            | write_general
        -else
            | write_overview
    | finalize
"#;
    let c = compile(src).unwrap();
    let w = &c.workflows["w"];
    let branch = w
        .nodes
        .values()
        .find_map(|n| {
            if let RuntimeNode::Branch(b) = n {
                Some(b)
            } else {
                None
            }
        })
        .expect("branch node");
    assert_eq!(branch.mode, BranchMode::Branch);
    assert!(branch.arms.contains_key("tech"));
    assert!(branch.arms.contains_key("general"));
    assert!(branch.else_node_id.is_some(), "else arm must be present");
    assert!(
        branch.branch_back_id.is_some(),
        "branch_back_id must be set"
    );
}

#[test]
fn loop_creates_loop_branch_with_until_arm() {
    let src = r#"
workflow "w"
    | @loop
        | ask_human
        -until "yes"
    | done
"#;
    let c = compile(src).unwrap();
    let w = &c.workflows["w"];
    let branch = w
        .nodes
        .values()
        .find_map(|n| {
            if let RuntimeNode::Branch(b) = n {
                Some(b)
            } else {
                None
            }
        })
        .expect("loop branch");
    assert_eq!(branch.mode, BranchMode::Loop);
    assert_eq!(branch.loop_until.as_deref(), Some("yes"));
    assert!(
        branch.arms.contains_key("yes"),
        "until label must be an arm"
    );
}

#[test]
fn unordered_exposes_case_entries_and_back_node() {
    let src = r#"
workflow "w"
    | prep
    | @unordered
        -step "a"
            | run_a
        -step "b"
            | run_b
    | done
"#;
    let c = compile(src).unwrap();
    let w = &c.workflows["w"];
    let unordered = w
        .nodes
        .values()
        .find_map(|n| {
            if let RuntimeNode::Unordered(u) = n {
                Some(u)
            } else {
                None
            }
        })
        .expect("unordered node");
    assert!(unordered.case_entry_ids.contains_key("a"));
    assert!(unordered.case_entry_ids.contains_key("b"));
    assert!(unordered.back_node_id.is_some());
}

#[test]
fn start_connects_to_first_step_and_end_is_reachable() {
    let src = r#"
workflow "w"
    | first
    | second
"#;
    let c = compile(src).unwrap();
    let w = &c.workflows["w"];
    let start = match &w.nodes[&w.start_node_id] {
        RuntimeNode::Start(s) => s,
        _ => panic!("start node"),
    };
    assert_eq!(start.next_ids.len(), 1, "start → first step");
    // Walk forward and confirm end is reachable.
    let mut seen = std::collections::HashSet::new();
    let mut stack = start.next_ids.clone();
    while let Some(id) = stack.pop() {
        if !seen.insert(id.clone()) {
            continue;
        }
        if id == w.end_node_id {
            return;
        }
        stack.extend(w.nodes[&id].next_ids().iter().cloned());
    }
    panic!("end node not reachable from start");
}

#[test]
fn empty_workflow_wires_start_directly_to_end() {
    let src = r#"
workflow "w"
"#;
    let c = compile(src).unwrap();
    let w = &c.workflows["w"];
    let start = match &w.nodes[&w.start_node_id] {
        RuntimeNode::Start(s) => s,
        _ => panic!(),
    };
    assert_eq!(start.next_ids, vec![w.end_node_id.clone()]);
}
