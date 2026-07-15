#include "complier/compiler.hpp"

#include <format>
#include <utility>

#include "complier/error.hpp"
#include "complier/runtime.hpp"

namespace complier {

namespace {

// entry and exit points of a compiled step sequence
struct Wiring {
    std::string entry_id;
    std::vector<std::string> exit_ids;
};

struct WorkflowCompiler {
    const std::map<std::string, ast::Constraint>& guarantees;
    const std::string& workflow_name;
    std::map<std::string, rt::Node> nodes;
    int counter = 0;

    std::string new_id(const char* prefix) {
        return std::format("{}:{}:{}", workflow_name, prefix, ++counter);
    }

    rt::Node& add(const char* prefix, rt::NodeData data,
                  std::vector<ast::Constraint> guards = {}) {
        std::string id = new_id(prefix);
        auto [it, inserted] = nodes.emplace(
            id, rt::Node{id, {}, std::move(guards), std::move(data)});
        return it->second;
    }

    const ast::Constraint& resolve_guarantee(const std::string& name) const {
        auto it = guarantees.find(name);
        if (it == guarantees.end())
            throw CompileError(std::format("unknown guarantee reference: {}", name));
        return it->second;
    }

    rt::CompiledWorkflow compile(const ast::Workflow& workflow) {
        std::vector<ast::Constraint> guards;
        for (const auto& name : workflow.always) guards.push_back(resolve_guarantee(name));

        rt::Node& start = add("start", rt::StartNode{});
        std::string end_id = add("end", rt::EndNode{}).id;

        if (!workflow.steps.empty()) {
            Wiring wiring = compile_steps(workflow.steps, guards);
            start.next_ids.push_back(wiring.entry_id);
            for (const auto& exit_id : wiring.exit_ids)
                nodes.at(exit_id).next_ids.push_back(end_id);
        } else {
            start.next_ids.push_back(end_id);
        }

        rt::CompiledWorkflow out;
        out.name = workflow.name;
        out.start_node_id = start.id;
        out.end_node_id = std::move(end_id);
        out.ambient.insert(workflow.ambient.begin(), workflow.ambient.end());
        out.nodes = std::move(nodes);
        return out;
    }

    Wiring compile_steps(const std::vector<ast::Step>& steps,
                         const std::vector<ast::Constraint>& guards) {
        Wiring first = compile_step(steps[0], guards);
        std::vector<std::string> pending = std::move(first.exit_ids);
        for (std::size_t i = 1; i < steps.size(); ++i) {
            Wiring next = compile_step(steps[i], guards);
            for (const auto& exit_id : pending)
                nodes.at(exit_id).next_ids.push_back(next.entry_id);
            pending = std::move(next.exit_ids);
        }
        return {first.entry_id, std::move(pending)};
    }

    Wiring compile_step(const ast::Step& step, const std::vector<ast::Constraint>& guards) {
        if (const auto* tool = std::get_if<ast::ToolStep>(&step.value)) {
            std::map<std::string, ast::ParamValue> params;
            for (const auto& param : tool->params) params[param.name] = param.value;
            rt::Node& node = add("tool", rt::ToolNode{tool->name, std::move(params)}, guards);
            return {node.id, {node.id}};
        }
        if (const auto* human = std::get_if<ast::HumanStep>(&step.value)) {
            rt::Node& node = add("human", rt::HumanNode{human->prompt}, guards);
            return {node.id, {node.id}};
        }
        if (const auto* llm = std::get_if<ast::LlmStep>(&step.value)) {
            rt::Node& node = add("llm", rt::LlmNode{llm->prompt}, guards);
            return {node.id, {node.id}};
        }
        if (const auto* call = std::get_if<ast::SubworkflowStep>(&step.value)) {
            rt::Node& node =
                add("call", rt::CallNode{call->call_type, call->workflow_name}, guards);
            return {node.id, {node.id}};
        }
        if (const auto* fork = std::get_if<ast::ForkStep>(&step.value)) {
            rt::Node& node = add(
                "fork",
                rt::ForkNode{fork->fork_id, fork->target.call_type, fork->target.workflow_name},
                guards);
            return {node.id, {node.id}};
        }
        if (const auto* join = std::get_if<ast::JoinStep>(&step.value)) {
            rt::Node& node = add("join", rt::JoinNode{join->fork_id}, guards);
            return {node.id, {node.id}};
        }
        if (const auto* branch = std::get_if<ast::BranchStep>(&step.value))
            return compile_branch(*branch, guards);
        if (const auto* loop = std::get_if<ast::LoopStep>(&step.value))
            return compile_loop(*loop, guards);
        const auto& unordered = std::get<ast::UnorderedStep>(step.value);
        return compile_unordered(unordered, guards);
    }

    Wiring compile_branch(const ast::BranchStep& step,
                          const std::vector<ast::Constraint>& guards) {
        rt::Node& back = add("branch_back", rt::BranchBackNode{});
        rt::Node& branch = add("branch", rt::BranchNode{});
        auto& data = std::get<rt::BranchNode>(branch.data);
        data.branch_back_id = back.id;

        for (const auto& arm : step.when_arms) {
            Wiring wiring = compile_steps(arm.steps, guards);
            data.arms.emplace_back(arm.condition, wiring.entry_id);
            for (const auto& exit_id : wiring.exit_ids)
                nodes.at(exit_id).next_ids.push_back(back.id);
        }

        if (step.else_arm) {
            Wiring wiring = compile_steps(step.else_arm->steps, guards);
            data.else_node_id = wiring.entry_id;
            for (const auto& exit_id : wiring.exit_ids)
                nodes.at(exit_id).next_ids.push_back(back.id);
        } else {
            data.else_node_id = back.id;
        }

        return {branch.id, {back.id}};
    }

    // a loop is a branch whose until-arm jumps straight to the back node and
    // whose else-arm re-enters the body
    Wiring compile_loop(const ast::LoopStep& step, const std::vector<ast::Constraint>& guards) {
        rt::Node& back = add("loop_back", rt::BranchBackNode{});
        rt::Node& branch = add("loop_branch", rt::BranchNode{});
        auto& data = std::get<rt::BranchNode>(branch.data);
        data.is_loop = true;
        data.loop_until = step.until;
        data.branch_back_id = back.id;

        Wiring body = compile_steps(step.steps, guards);
        data.arms.emplace_back(step.until, back.id);
        data.else_node_id = body.entry_id;
        for (const auto& exit_id : body.exit_ids)
            nodes.at(exit_id).next_ids.push_back(branch.id);

        return {branch.id, {back.id}};
    }

    Wiring compile_unordered(const ast::UnorderedStep& step,
                             const std::vector<ast::Constraint>& guards) {
        rt::Node& back = add("unordered_back", rt::UnorderedBackNode{});
        rt::Node& unordered = add("unordered", rt::UnorderedNode{});
        auto& data = std::get<rt::UnorderedNode>(unordered.data);
        data.back_node_id = back.id;

        for (const auto& c : step.cases) {
            Wiring wiring = compile_steps(c.steps, guards);
            data.cases.emplace_back(c.label, wiring.entry_id);
            for (const auto& exit_id : wiring.exit_ids)
                nodes.at(exit_id).next_ids.push_back(back.id);
        }

        return {unordered.id, {back.id}};
    }
};

}  // namespace

Contract compile(const ast::Program& program, std::string_view source) {
    std::map<std::string, ast::Constraint> guarantees;
    for (const auto& item : program.items)
        if (const auto* g = std::get_if<ast::Guarantee>(&item)) guarantees[g->name] = g->expression;

    Contract contract;
    contract.name = "anonymous";
    for (const auto& item : program.items) {
        if (const auto* wf = std::get_if<ast::Workflow>(&item)) {
            WorkflowCompiler wc{guarantees, wf->name, {}, 0};
            contract.workflows[wf->name] = wc.compile(*wf);
        }
    }
    contract.guarantees = std::move(guarantees);
    contract.source = std::string(source);
    return contract;
}

}  // namespace complier
