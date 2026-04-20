use serde::{Deserialize, Serialize};

// ── Checks ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelCheck {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HumanCheck {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LearnedCheck {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Check {
    Model(ModelCheck),
    Human(HumanCheck),
    Learned(LearnedCheck),
}

// ── Policy ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RetryPolicy {
    pub attempts: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Policy {
    Retry(RetryPolicy),
    Halt,
    Skip,
}

impl Default for Policy {
    fn default() -> Self {
        Policy::Retry(RetryPolicy { attempts: 3 })
    }
}

// ── ProseGuard ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProseGuard {
    pub prose: String,
    pub checks: Vec<Check>,
    pub policy: Policy,
}

// ── ParamValue ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ParamValue {
    String(String),
    Int(i64),
    Bool(bool),
    Null,
    Guard(Box<ProseGuard>),
}

// ── Steps ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LlmStep {
    pub prompt: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HumanStep {
    pub prompt: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubworkflowStep {
    pub call_type: String,
    pub workflow_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ForkStep {
    pub fork_id: String,
    pub target: SubworkflowStep,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JoinStep {
    pub fork_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Param {
    pub name: String,
    pub value: ParamValue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolStep {
    pub name: String,
    pub params: Vec<Param>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WhenArm {
    pub condition: String,
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ElseArm {
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BranchStep {
    pub when_arms: Vec<WhenArm>,
    pub else_arm: Option<ElseArm>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoopStep {
    pub steps: Vec<Step>,
    pub until: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UnorderedCase {
    pub label: String,
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UnorderedStep {
    pub cases: Vec<UnorderedCase>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Step {
    Llm(LlmStep),
    Human(HumanStep),
    Subworkflow(SubworkflowStep),
    Fork(ForkStep),
    Join(JoinStep),
    Tool(ToolStep),
    Branch(BranchStep),
    Loop(LoopStep),
    Unordered(UnorderedStep),
}

// ── Top-level ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Guarantee {
    pub name: String,
    pub expression: ProseGuard,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Workflow {
    pub name: String,
    pub always: Vec<String>,
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Item {
    Guarantee(Guarantee),
    Workflow(Workflow),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Program {
    pub items: Vec<Item>,
}
