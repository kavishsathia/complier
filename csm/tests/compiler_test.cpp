#include "complier/compiler.hpp"
#include "complier/error.hpp"
#include "complier/parser.hpp"
#include "testing.hpp"

#include <variant>

using namespace complier;

namespace {

Contract compile_source(const char* source) { return compile(parse(source), source); }

}  // namespace

TEST(compiles_a_linear_workflow) {
    auto contract = compile_source(
        "workflow \"w\"\n"
        "    | a\n"
        "    | b\n");
    const auto& wf = contract.workflows.at("w");
    CHECK_EQ(wf.start_node_id, "w:start:1");
    CHECK_EQ(wf.end_node_id, "w:end:2");
    CHECK_EQ(wf.nodes.size(), 4u);

    CHECK_EQ(wf.nodes.at("w:start:1").next_ids, (std::vector<std::string>{"w:tool:3"}));
    CHECK_EQ(wf.nodes.at("w:tool:3").next_ids, (std::vector<std::string>{"w:tool:4"}));
    CHECK_EQ(wf.nodes.at("w:tool:4").next_ids, (std::vector<std::string>{"w:end:2"}));
    CHECK(wf.nodes.at("w:end:2").next_ids.empty());

    CHECK_EQ(std::get<rt::ToolNode>(wf.nodes.at("w:tool:3").data).tool_name, "a");
}

TEST(attaches_always_guards_to_executable_nodes) {
    auto contract = compile_source(
        "guarantee clean `env.deploys == 0`\n"
        "workflow \"w\" @always clean\n"
        "    | a\n");
    const auto& wf = contract.workflows.at("w");
    const auto& tool = wf.nodes.at("w:tool:3");
    CHECK_EQ(tool.guards.size(), 1u);
    CHECK(tool.guards[0].kind == ast::Constraint::Kind::Cel);
    CHECK_EQ(tool.guards[0].text, "env.deploys == 0");
    CHECK(wf.nodes.at("w:start:1").guards.empty());
}

TEST(unknown_guarantee_reference_fails) {
    CHECK_THROWS(compile_source(
        "workflow \"w\" @always missing\n"
        "    | a\n"));
}

TEST(compiles_branches) {
    auto contract = compile_source(
        "workflow \"w\"\n"
        "    | @branch\n"
        "        -when \"x\"\n"
        "            | a\n"
        "        -else\n"
        "            | b\n"
        "    | c\n");
    const auto& wf = contract.workflows.at("w");
    // start:1 end:2 branch_back:3 branch:4 tool:5(a) tool:6(b) tool:7(c)
    const auto& branch = std::get<rt::BranchNode>(wf.nodes.at("w:branch:4").data);
    CHECK_EQ(branch.arms.size(), 1u);
    CHECK_EQ(branch.arms[0].first, "x");
    CHECK_EQ(branch.arms[0].second, "w:tool:5");
    CHECK_EQ(branch.else_node_id, "w:tool:6");
    CHECK_EQ(branch.branch_back_id, "w:branch_back:3");
    CHECK(!branch.is_loop);

    CHECK_EQ(wf.nodes.at("w:start:1").next_ids, (std::vector<std::string>{"w:branch:4"}));
    CHECK_EQ(wf.nodes.at("w:tool:5").next_ids, (std::vector<std::string>{"w:branch_back:3"}));
    CHECK_EQ(wf.nodes.at("w:tool:6").next_ids, (std::vector<std::string>{"w:branch_back:3"}));
    CHECK_EQ(wf.nodes.at("w:branch_back:3").next_ids, (std::vector<std::string>{"w:tool:7"}));
}

TEST(branch_without_else_falls_through_to_back) {
    auto contract = compile_source(
        "workflow \"w\"\n"
        "    | @branch\n"
        "        -when \"x\"\n"
        "            | a\n");
    const auto& wf = contract.workflows.at("w");
    const auto& branch = std::get<rt::BranchNode>(wf.nodes.at("w:branch:4").data);
    CHECK_EQ(branch.else_node_id, "w:branch_back:3");
}

TEST(compiles_loops) {
    auto contract = compile_source(
        "workflow \"w\"\n"
        "    | @loop\n"
        "        | poll\n"
        "        -until \"done\"\n");
    const auto& wf = contract.workflows.at("w");
    // start:1 end:2 loop_back:3 loop_branch:4 tool:5(poll)
    const auto& branch = std::get<rt::BranchNode>(wf.nodes.at("w:loop_branch:4").data);
    CHECK(branch.is_loop);
    CHECK_EQ(branch.loop_until, "done");
    CHECK_EQ(branch.arms.size(), 1u);
    CHECK_EQ(branch.arms[0].first, "done");
    CHECK_EQ(branch.arms[0].second, "w:loop_back:3");
    CHECK_EQ(branch.else_node_id, "w:tool:5");

    CHECK_EQ(wf.nodes.at("w:tool:5").next_ids, (std::vector<std::string>{"w:loop_branch:4"}));
    CHECK_EQ(wf.nodes.at("w:loop_back:3").next_ids, (std::vector<std::string>{"w:end:2"}));
}

TEST(compiles_unordered_blocks) {
    auto contract = compile_source(
        "workflow \"w\"\n"
        "    | @unordered\n"
        "        -step \"docs\"\n"
        "            | update_docs\n"
        "        -step \"tests\"\n"
        "            | run_tests\n");
    const auto& wf = contract.workflows.at("w");
    // start:1 end:2 unordered_back:3 unordered:4 tool:5 tool:6
    const auto& unordered = std::get<rt::UnorderedNode>(wf.nodes.at("w:unordered:4").data);
    CHECK_EQ(unordered.back_node_id, "w:unordered_back:3");
    CHECK_EQ(unordered.cases.size(), 2u);
    CHECK_EQ(unordered.cases[0].first, "docs");
    CHECK_EQ(unordered.cases[0].second, "w:tool:5");
    CHECK_EQ(unordered.cases[1].second, "w:tool:6");
    CHECK_EQ(wf.nodes.at("w:tool:5").next_ids, (std::vector<std::string>{"w:unordered_back:3"}));
    CHECK_EQ(wf.nodes.at("w:unordered_back:3").next_ids, (std::vector<std::string>{"w:end:2"}));
}

TEST(collects_guarantees_ambient_and_multiple_workflows) {
    auto contract = compile_source(
        "guarantee clean `ok`\n"
        "workflow \"a\" @ambient read grep\n"
        "    | @call b\n"
        "workflow \"b\"\n"
        "    | t\n");
    CHECK_EQ(contract.name, "anonymous");
    CHECK_EQ(contract.guarantees.size(), 1u);
    CHECK_EQ(contract.workflows.size(), 2u);
    CHECK(contract.workflows.at("a").ambient == (std::set<std::string>{"grep", "read"}));

    const auto& call = std::get<rt::CallNode>(contract.workflows.at("a").nodes.at("a:call:3").data);
    CHECK(call.call_type == ast::CallType::Call);
    CHECK_EQ(call.workflow_name, "b");
}

TEST(fork_and_join_nodes_carry_their_target) {
    auto contract = compile_source(
        "workflow \"w\"\n"
        "    | @fork f1 @use notify\n"
        "    | @join f1\n");
    const auto& wf = contract.workflows.at("w");
    const auto& fork = std::get<rt::ForkNode>(wf.nodes.at("w:fork:3").data);
    CHECK_EQ(fork.fork_id, "f1");
    CHECK(fork.call_type == ast::CallType::Use);
    CHECK_EQ(fork.workflow_name, "notify");
    CHECK_EQ(std::get<rt::JoinNode>(wf.nodes.at("w:join:4").data).fork_id, "f1");
}

TEST(tool_params_reach_the_node) {
    auto contract = compile_source(
        "workflow \"w\"\n"
        "    | deploy env=\"prod\" replicas=3 gate={ops approve}:halt\n");
    const auto& wf = contract.workflows.at("w");
    const auto& tool = std::get<rt::ToolNode>(wf.nodes.at("w:tool:3").data);
    CHECK_EQ(std::get<std::string>(tool.params.at("env")), "prod");
    CHECK_EQ(std::get<std::int64_t>(tool.params.at("replicas")), 3);
    const auto& gate = std::get<ast::Constraint>(tool.params.at("gate"));
    CHECK(gate.kind == ast::Constraint::Kind::Human);
    CHECK(gate.policy.kind == ast::Policy::Kind::Halt);
}
