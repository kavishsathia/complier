use std::collections::HashMap;

use ast::{ParamValue, ProseGuard};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompiledWorkflow {
    pub name: String,
    pub start_node_id: String,
    pub end_node_id: String,
    pub nodes: HashMap<String, RuntimeNode>,
}

// ── Node types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum RuntimeNode {
    Start(StartNode),
    End(EndNode),
    Tool(ToolNode),
    Human(HumanNode),
    Llm(LlmNode),
    Call(CallNode),
    Fork(ForkNode),
    Join(JoinNode),
    Branch(BranchNode),
    BranchBack(BranchBackNode),
    Unordered(UnorderedNode),
    UnorderedBack(UnorderedBackNode),
}

impl RuntimeNode {
    pub fn id(&self) -> &str {
        match self {
            RuntimeNode::Start(n) => &n.id,
            RuntimeNode::End(n) => &n.id,
            RuntimeNode::Tool(n) => &n.id,
            RuntimeNode::Human(n) => &n.id,
            RuntimeNode::Llm(n) => &n.id,
            RuntimeNode::Call(n) => &n.id,
            RuntimeNode::Fork(n) => &n.id,
            RuntimeNode::Join(n) => &n.id,
            RuntimeNode::Branch(n) => &n.id,
            RuntimeNode::BranchBack(n) => &n.id,
            RuntimeNode::Unordered(n) => &n.id,
            RuntimeNode::UnorderedBack(n) => &n.id,
        }
    }

    pub fn next_ids(&self) -> &[String] {
        match self {
            RuntimeNode::Start(n) => &n.next_ids,
            RuntimeNode::End(n) => &n.next_ids,
            RuntimeNode::Tool(n) => &n.next_ids,
            RuntimeNode::Human(n) => &n.next_ids,
            RuntimeNode::Llm(n) => &n.next_ids,
            RuntimeNode::Call(n) => &n.next_ids,
            RuntimeNode::Fork(n) => &n.next_ids,
            RuntimeNode::Join(n) => &n.next_ids,
            RuntimeNode::Branch(n) => &n.next_ids,
            RuntimeNode::BranchBack(n) => &n.next_ids,
            RuntimeNode::Unordered(n) => &n.next_ids,
            RuntimeNode::UnorderedBack(n) => &n.next_ids,
        }
    }

    pub fn next_ids_mut(&mut self) -> &mut Vec<String> {
        match self {
            RuntimeNode::Start(n) => &mut n.next_ids,
            RuntimeNode::End(n) => &mut n.next_ids,
            RuntimeNode::Tool(n) => &mut n.next_ids,
            RuntimeNode::Human(n) => &mut n.next_ids,
            RuntimeNode::Llm(n) => &mut n.next_ids,
            RuntimeNode::Call(n) => &mut n.next_ids,
            RuntimeNode::Fork(n) => &mut n.next_ids,
            RuntimeNode::Join(n) => &mut n.next_ids,
            RuntimeNode::Branch(n) => &mut n.next_ids,
            RuntimeNode::BranchBack(n) => &mut n.next_ids,
            RuntimeNode::Unordered(n) => &mut n.next_ids,
            RuntimeNode::UnorderedBack(n) => &mut n.next_ids,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartNode {
    pub id: String,
    pub next_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndNode {
    pub id: String,
    pub next_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolNode {
    pub id: String,
    pub next_ids: Vec<String>,
    pub guards: Vec<ProseGuard>,
    pub tool_name: String,
    pub params: HashMap<String, ParamValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HumanNode {
    pub id: String,
    pub next_ids: Vec<String>,
    pub guards: Vec<ProseGuard>,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmNode {
    pub id: String,
    pub next_ids: Vec<String>,
    pub guards: Vec<ProseGuard>,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallNode {
    pub id: String,
    pub next_ids: Vec<String>,
    pub guards: Vec<ProseGuard>,
    pub call_type: String,
    pub workflow_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForkNode {
    pub id: String,
    pub next_ids: Vec<String>,
    pub guards: Vec<ProseGuard>,
    pub fork_id: String,
    pub call_type: String,
    pub workflow_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinNode {
    pub id: String,
    pub next_ids: Vec<String>,
    pub guards: Vec<ProseGuard>,
    pub fork_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum BranchMode {
    Branch,
    Loop,
}

impl Default for BranchMode {
    fn default() -> Self {
        BranchMode::Branch
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchNode {
    pub id: String,
    pub next_ids: Vec<String>,
    pub arms: HashMap<String, String>,
    pub else_node_id: Option<String>,
    pub branch_back_id: Option<String>,
    pub mode: BranchMode,
    pub loop_until: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchBackNode {
    pub id: String,
    pub next_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnorderedNode {
    pub id: String,
    pub next_ids: Vec<String>,
    pub case_entry_ids: HashMap<String, String>,
    pub back_node_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnorderedBackNode {
    pub id: String,
    pub next_ids: Vec<String>,
}
