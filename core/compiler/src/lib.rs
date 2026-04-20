use std::collections::HashMap;

use ast::*;
use runtime::*;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CompileError {
    #[error("unknown guarantee: {0}")]
    UnknownGuarantee(String),
}

/// Top-level compiled contract: all workflows + guarantee map.
#[derive(Debug, Clone)]
pub struct Contract {
    pub name: String,
    pub workflows: HashMap<String, CompiledWorkflow>,
    pub guarantees: HashMap<String, ProseGuard>,
}

impl Contract {
    pub fn from_program(program: &Program) -> Result<Self, CompileError> {
        let guarantees: HashMap<String, ProseGuard> = program
            .items
            .iter()
            .filter_map(|item| {
                if let Item::Guarantee(g) = item {
                    Some((g.name.clone(), g.expression.clone()))
                } else {
                    None
                }
            })
            .collect();

        let workflows = program
            .items
            .iter()
            .filter_map(|item| {
                if let Item::Workflow(w) = item {
                    Some(w)
                } else {
                    None
                }
            })
            .map(|w| {
                let compiled = WorkflowCompiler::new(&guarantees, &w.name).compile(w)?;
                Ok((w.name.clone(), compiled))
            })
            .collect::<Result<HashMap<_, _>, CompileError>>()?;

        Ok(Contract {
            name: "anonymous".to_string(),
            workflows,
            guarantees,
        })
    }
}

// ── WorkflowCompiler ──────────────────────────────────────────────────────────

struct WorkflowCompiler<'a> {
    guarantees: &'a HashMap<String, ProseGuard>,
    workflow_name: &'a str,
    nodes: HashMap<String, RuntimeNode>,
    counter: usize,
}

struct CompileResult {
    entry_id: String,
    exit_ids: Vec<String>,
}

impl<'a> WorkflowCompiler<'a> {
    fn new(guarantees: &'a HashMap<String, ProseGuard>, workflow_name: &'a str) -> Self {
        Self {
            guarantees,
            workflow_name,
            nodes: HashMap::new(),
            counter: 0,
        }
    }

    fn compile(mut self, workflow: &Workflow) -> Result<CompiledWorkflow, CompileError> {
        let inherited: Vec<ProseGuard> = workflow
            .always
            .iter()
            .map(|name| {
                self.guarantees
                    .get(name)
                    .cloned()
                    .ok_or_else(|| CompileError::UnknownGuarantee(name.clone()))
            })
            .collect::<Result<_, _>>()?;

        let start_id = self.new_id("start");
        let end_id = self.new_id("end");

        self.nodes.insert(start_id.clone(), RuntimeNode::Start(StartNode { id: start_id.clone(), next_ids: vec![] }));
        self.nodes.insert(end_id.clone(), RuntimeNode::End(EndNode { id: end_id.clone(), next_ids: vec![] }));

        if !workflow.steps.is_empty() {
            let result = self.compile_steps(&workflow.steps, &inherited)?;
            self.nodes.get_mut(&start_id).unwrap().next_ids_mut().push(result.entry_id.clone());
            for exit_id in &result.exit_ids {
                self.nodes.get_mut(exit_id).unwrap().next_ids_mut().push(end_id.clone());
            }
        } else {
            self.nodes.get_mut(&start_id).unwrap().next_ids_mut().push(end_id.clone());
        }

        Ok(CompiledWorkflow {
            name: workflow.name.clone(),
            start_node_id: start_id,
            end_node_id: end_id,
            nodes: self.nodes,
        })
    }

    fn compile_steps(&mut self, steps: &[Step], inherited: &[ProseGuard]) -> Result<CompileResult, CompileError> {
        let compiled: Vec<CompileResult> = steps
            .iter()
            .map(|s| self.compile_step(s, inherited))
            .collect::<Result<_, _>>()?;

        let entry_id = compiled[0].entry_id.clone();
        let mut pending: Vec<String> = compiled[0].exit_ids.clone();

        for next in compiled.iter().skip(1) {
            for exit_id in &pending {
                self.nodes.get_mut(exit_id).unwrap().next_ids_mut().push(next.entry_id.clone());
            }
            pending = next.exit_ids.clone();
        }

        Ok(CompileResult { entry_id, exit_ids: pending })
    }

    fn compile_step(&mut self, step: &Step, inherited: &[ProseGuard]) -> Result<CompileResult, CompileError> {
        match step {
            Step::Tool(s) => {
                let id = self.new_id("tool");
                let params: HashMap<String, ParamValue> = s.params.iter()
                    .map(|p| (p.name.clone(), p.value.clone()))
                    .collect();
                self.nodes.insert(id.clone(), RuntimeNode::Tool(ToolNode {
                    id: id.clone(),
                    next_ids: vec![],
                    guards: inherited.to_vec(),
                    tool_name: s.name.clone(),
                    params,
                }));
                Ok(CompileResult { entry_id: id.clone(), exit_ids: vec![id] })
            }

            Step::Human(s) => {
                let id = self.new_id("human");
                self.nodes.insert(id.clone(), RuntimeNode::Human(HumanNode {
                    id: id.clone(), next_ids: vec![], guards: inherited.to_vec(), prompt: s.prompt.clone(),
                }));
                Ok(CompileResult { entry_id: id.clone(), exit_ids: vec![id] })
            }

            Step::Llm(s) => {
                let id = self.new_id("llm");
                self.nodes.insert(id.clone(), RuntimeNode::Llm(LlmNode {
                    id: id.clone(), next_ids: vec![], guards: inherited.to_vec(), prompt: s.prompt.clone(),
                }));
                Ok(CompileResult { entry_id: id.clone(), exit_ids: vec![id] })
            }

            Step::Subworkflow(s) => {
                let id = self.new_id("call");
                self.nodes.insert(id.clone(), RuntimeNode::Call(CallNode {
                    id: id.clone(), next_ids: vec![], guards: inherited.to_vec(),
                    call_type: s.call_type.clone(), workflow_name: s.workflow_name.clone(),
                }));
                Ok(CompileResult { entry_id: id.clone(), exit_ids: vec![id] })
            }

            Step::Fork(s) => {
                let id = self.new_id("fork");
                self.nodes.insert(id.clone(), RuntimeNode::Fork(ForkNode {
                    id: id.clone(), next_ids: vec![], guards: inherited.to_vec(),
                    fork_id: s.fork_id.clone(),
                    call_type: s.target.call_type.clone(),
                    workflow_name: s.target.workflow_name.clone(),
                }));
                Ok(CompileResult { entry_id: id.clone(), exit_ids: vec![id] })
            }

            Step::Join(s) => {
                let id = self.new_id("join");
                self.nodes.insert(id.clone(), RuntimeNode::Join(JoinNode {
                    id: id.clone(), next_ids: vec![], guards: inherited.to_vec(),
                    fork_id: s.fork_id.clone(),
                }));
                Ok(CompileResult { entry_id: id.clone(), exit_ids: vec![id] })
            }

            Step::Branch(s) => self.compile_branch(s, inherited),
            Step::Loop(s)   => self.compile_loop(s, inherited),
            Step::Unordered(s) => self.compile_unordered(s, inherited),
        }
    }

    fn compile_branch(&mut self, step: &BranchStep, inherited: &[ProseGuard]) -> Result<CompileResult, CompileError> {
        let back_id = self.new_id("branch_back");
        let branch_id = self.new_id("branch");

        self.nodes.insert(back_id.clone(), RuntimeNode::BranchBack(BranchBackNode { id: back_id.clone(), next_ids: vec![] }));

        let mut arms = HashMap::new();
        for arm in &step.when_arms {
            let compiled = self.compile_steps(&arm.steps, inherited)?;
            arms.insert(arm.condition.clone(), compiled.entry_id.clone());
            for exit_id in &compiled.exit_ids {
                self.nodes.get_mut(exit_id).unwrap().next_ids_mut().push(back_id.clone());
            }
        }

        let else_node_id = if let Some(else_arm) = &step.else_arm {
            let compiled = self.compile_steps(&else_arm.steps, inherited)?;
            for exit_id in &compiled.exit_ids {
                self.nodes.get_mut(exit_id).unwrap().next_ids_mut().push(back_id.clone());
            }
            Some(compiled.entry_id)
        } else {
            Some(back_id.clone())
        };

        self.nodes.insert(branch_id.clone(), RuntimeNode::Branch(BranchNode {
            id: branch_id.clone(), next_ids: vec![], arms,
            else_node_id, branch_back_id: Some(back_id.clone()),
            mode: BranchMode::Branch, loop_until: None,
        }));

        Ok(CompileResult { entry_id: branch_id, exit_ids: vec![back_id] })
    }

    fn compile_loop(&mut self, step: &LoopStep, inherited: &[ProseGuard]) -> Result<CompileResult, CompileError> {
        let back_id = self.new_id("loop_back");
        let branch_id = self.new_id("loop_branch");

        self.nodes.insert(back_id.clone(), RuntimeNode::BranchBack(BranchBackNode { id: back_id.clone(), next_ids: vec![] }));

        let compiled_body = self.compile_steps(&step.steps, inherited)?;

        // branch.arms[until] = back_id (exit), else = body entry (continue looping)
        let mut arms = HashMap::new();
        arms.insert(step.until.clone(), back_id.clone());

        for exit_id in &compiled_body.exit_ids {
            self.nodes.get_mut(exit_id).unwrap().next_ids_mut().push(branch_id.clone());
        }

        self.nodes.insert(branch_id.clone(), RuntimeNode::Branch(BranchNode {
            id: branch_id.clone(), next_ids: vec![], arms,
            else_node_id: Some(compiled_body.entry_id),
            branch_back_id: Some(back_id.clone()),
            mode: BranchMode::Loop, loop_until: Some(step.until.clone()),
        }));

        Ok(CompileResult { entry_id: branch_id, exit_ids: vec![back_id] })
    }

    fn compile_unordered(&mut self, step: &UnorderedStep, inherited: &[ProseGuard]) -> Result<CompileResult, CompileError> {
        let back_id = self.new_id("unordered_back");
        let node_id = self.new_id("unordered");

        self.nodes.insert(back_id.clone(), RuntimeNode::UnorderedBack(UnorderedBackNode { id: back_id.clone(), next_ids: vec![] }));

        let mut case_entry_ids = HashMap::new();
        for case in &step.cases {
            let compiled = self.compile_steps(&case.steps, inherited)?;
            case_entry_ids.insert(case.label.clone(), compiled.entry_id.clone());
            for exit_id in &compiled.exit_ids {
                self.nodes.get_mut(exit_id).unwrap().next_ids_mut().push(back_id.clone());
            }
        }

        self.nodes.insert(node_id.clone(), RuntimeNode::Unordered(UnorderedNode {
            id: node_id.clone(), next_ids: vec![], case_entry_ids, back_node_id: Some(back_id.clone()),
        }));

        Ok(CompileResult { entry_id: node_id, exit_ids: vec![back_id] })
    }

    fn new_id(&mut self, prefix: &str) -> String {
        self.counter += 1;
        format!("{}:{}:{}", self.workflow_name, prefix, self.counter)
    }
}
