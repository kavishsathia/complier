#pragma once

#include <map>
#include <set>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include "complier/ast.hpp"

namespace complier::rt {

struct StartNode {};
struct EndNode {};

struct ToolNode {
    std::string tool_name;
    std::map<std::string, ast::ParamValue> params;
};

struct HumanNode {
    std::string prompt;
};

struct LlmNode {
    std::string prompt;
};

struct CallNode {
    ast::CallType call_type = ast::CallType::Call;
    std::string workflow_name;
};

struct ForkNode {
    std::string fork_id;
    ast::CallType call_type = ast::CallType::Call;
    std::string workflow_name;
};

struct JoinNode {
    std::string fork_id;
};

struct BranchNode {
    std::vector<std::pair<std::string, std::string>> arms;  // condition -> arm entry node
    std::string else_node_id;
    std::string branch_back_id;
    bool is_loop = false;
    std::string loop_until;
};

struct BranchBackNode {};

struct UnorderedNode {
    std::vector<std::pair<std::string, std::string>> cases;  // label -> case entry node
    std::string back_node_id;
};

struct UnorderedBackNode {};

using NodeData = std::variant<StartNode, EndNode, ToolNode, HumanNode, LlmNode, CallNode, ForkNode,
                              JoinNode, BranchNode, BranchBackNode, UnorderedNode, UnorderedBackNode>;

struct Node {
    std::string id;
    std::vector<std::string> next_ids;
    std::vector<ast::Constraint> guards;  // inherited @always guarantees, executable nodes only
    NodeData data;
};

struct CompiledWorkflow {
    std::string name;
    std::string start_node_id;
    std::string end_node_id;
    std::map<std::string, Node> nodes;
    std::set<std::string> ambient;
};

}  // namespace complier::rt
