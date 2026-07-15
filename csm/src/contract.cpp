#include "complier/contract.hpp"

#include <format>

#include "complier/compiler.hpp"
#include "complier/error.hpp"
#include "complier/parser.hpp"

namespace complier {

namespace {

void check_ref(const rt::CompiledWorkflow& wf, const std::string& from, const std::string& id) {
    if (!wf.nodes.contains(id))
        throw CompileError(std::format("workflow '{}': node '{}' references missing node '{}'",
                                       wf.name, from, id));
}

// every id a node mentions must exist in the graph
void validate(const Contract& contract) {
    for (const auto& [name, wf] : contract.workflows) {
        check_ref(wf, "start", wf.start_node_id);
        check_ref(wf, "end", wf.end_node_id);
        for (const auto& [id, node] : wf.nodes) {
            for (const auto& next_id : node.next_ids) check_ref(wf, id, next_id);
            if (const auto* branch = std::get_if<rt::BranchNode>(&node.data)) {
                for (const auto& [condition, entry_id] : branch->arms) check_ref(wf, id, entry_id);
                check_ref(wf, id, branch->else_node_id);
                check_ref(wf, id, branch->branch_back_id);
            } else if (const auto* unordered = std::get_if<rt::UnorderedNode>(&node.data)) {
                for (const auto& [label, entry_id] : unordered->cases) check_ref(wf, id, entry_id);
                check_ref(wf, id, unordered->back_node_id);
            }
        }
    }
}

}  // namespace

Contract Contract::from_source(std::string_view source) {
    Contract contract = compile(parse(source), source);
    validate(contract);
    return contract;
}

}  // namespace complier
