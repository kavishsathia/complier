#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace complier::ast {

struct Policy {
    enum class Kind { Halt, Skip, Retry };
    Kind kind = Kind::Retry;
    int attempts = 3;
};

struct Constraint {
    enum class Kind { Hint, Model, Human, Cel };
    Kind kind = Kind::Hint;
    std::string text;
    Policy policy;
};

using ParamValue = std::variant<std::monostate, std::string, std::int64_t, bool, Constraint>;

struct Param {
    std::string name;
    ParamValue value;
};

enum class CallType { Call, Use, Inline };

struct Step;

struct LlmStep {
    std::string prompt;
};

struct HumanStep {
    std::string prompt;
};

struct SubworkflowStep {
    CallType call_type = CallType::Call;
    std::string workflow_name;
};

struct ForkStep {
    std::string fork_id;
    SubworkflowStep target;
};

struct JoinStep {
    std::string fork_id;
};

struct ToolStep {
    std::string name;
    std::vector<Param> params;
};

struct WhenArm {
    std::string condition;
    std::vector<Step> steps;
};

struct ElseArm {
    std::vector<Step> steps;
};

struct BranchStep {
    std::vector<WhenArm> when_arms;
    std::optional<ElseArm> else_arm;
};

struct LoopStep {
    std::vector<Step> steps;
    std::string until;
};

struct UnorderedCase {
    std::string label;
    std::vector<Step> steps;
};

struct UnorderedStep {
    std::vector<UnorderedCase> cases;
};

struct Step {
    std::variant<LlmStep, HumanStep, SubworkflowStep, ForkStep, JoinStep, ToolStep, BranchStep,
                 LoopStep, UnorderedStep>
        value;
};

struct Guarantee {
    std::string name;
    Constraint expression;  // always Model, Human or Cel
};

struct Workflow {
    std::string name;
    std::vector<std::string> always;
    std::vector<std::string> ambient;
    std::vector<Step> steps;
};

using Item = std::variant<Guarantee, Workflow>;

struct Program {
    std::vector<Item> items;
};

}  // namespace complier::ast
