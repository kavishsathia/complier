/// Top-level program: a list of workflow and guarantee definitions.
#[derive(Debug)]
pub struct Program {
    pub items: Vec<Item>,
}

#[derive(Debug)]
pub enum Item {
    Workflow(Workflow),
    Guarantee(Guarantee),
}

#[derive(Debug)]
pub struct Workflow {
    pub name: String,
    pub always: Vec<String>,
    pub steps: Vec<Step>,
}

#[derive(Debug)]
pub struct Guarantee {
    pub name: String,
    pub contract: Contract,
}

#[derive(Debug)]
pub enum Step {
    Tool(ToolCall),
    Llm(LlmCall),
    Human(HumanCall),
    Branch(BranchBlock),
    Loop(LoopBlock),
    Unordered(UnorderedBlock),
    Fork(ForkStep),
    Join(JoinStep),
    SubWorkflow(SubWorkflowCall),
}

#[derive(Debug)]
pub struct ToolCall {
    pub name: String,
    pub params: Vec<Param>,
    pub contract: Option<Contract>,
    pub failure_policy: Option<FailurePolicy>,
}

#[derive(Debug)]
pub struct LlmCall {
    pub prompt: String,
    pub contract: Option<Contract>,
    pub failure_policy: Option<FailurePolicy>,
}

#[derive(Debug)]
pub struct HumanCall {
    pub prompt: String,
    pub contract: Option<Contract>,
}

#[derive(Debug)]
pub struct Param {
    pub name: String,
    pub value: ParamValue,
}

#[derive(Debug)]
pub enum ParamValue {
    String(String),
    Identifier(String),
}

#[derive(Debug)]
pub struct BranchBlock {
    pub arms: Vec<WhenArm>,
}

#[derive(Debug)]
pub struct WhenArm {
    pub pattern: String,
    pub steps: Vec<Step>,
}

#[derive(Debug)]
pub struct LoopBlock {
    pub steps: Vec<Step>,
    pub until: String,
}

#[derive(Debug)]
pub struct UnorderedBlock {
    pub steps: Vec<Step>,
}

#[derive(Debug)]
pub struct ForkStep {
    pub id: String,
    pub call_type: CallType,
    pub workflow: String,
}

#[derive(Debug)]
pub struct JoinStep {
    pub id: String,
}

#[derive(Debug)]
pub struct SubWorkflowCall {
    pub call_type: CallType,
    pub workflow: String,
}

#[derive(Debug)]
pub enum CallType {
    Call,
    Use,
    Inline,
}

#[derive(Debug)]
pub enum Contract {
    Literal(String),
    Wildcard,
    ModelCheck(String),
    HumanCheck(String),
    LearnedCheck(String),
    And(Box<Contract>, Box<Contract>),
    Or(Box<Contract>, Box<Contract>),
    Not(Box<Contract>),
    OneOf(Vec<Contract>),
    AnyOf(Vec<Contract>),
    FirstOf(Vec<Contract>),
    GuaranteeRef(String),
}

#[derive(Debug)]
pub enum FailurePolicy {
    Retry,
    Halt,
    Skip,
}
