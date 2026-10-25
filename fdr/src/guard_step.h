// FDR-independent step logic for the ControllableCHAOS runtime guard.
//
// An attempted A event is allowed (and the pointer advances) iff the current
// node has a transition for it; otherwise the attempt is blocked and an R event
// is followed.  This code never decides where refuse leads; it follows whatever
// successor the compiled guard has for the R event.  Under the current
// Policy ||| RefusalLoop(R) that successor is the same node, so the policy state
// is preserved; under the historical Policy /\ refusal loop it restarts Policy.
//
// The Graph type supplies:
//   using NodeRef = ...;
//   std::vector<Event> initials(const NodeRef&) const;
//   std::vector<NodeRef> afters(const NodeRef&, Event) const;
#pragma once

#include <algorithm>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace guard
{
using Event = unsigned int;

/// Same value as FDR::LTS::TAU (fdr/lts/events.h).
const Event TAU_EVENT = 1;

struct Alphabets
{
    std::set<Event> actions;   // A
    std::set<Event> refusals;  // R
};

struct Outcome
{
    bool allowed = false;
    Event refusal = 0;             // R event followed when !allowed
    std::vector<Event> permitted;  // A events enabled at the new node (R dropped)
};

/// The compiled guard broke an assumption the runtime relies on
/// (normalised: no tau, one successor per event; R always offered).
class InvariantViolation : public std::runtime_error
{
public:
    explicit InvariantViolation(const std::string& what) : std::runtime_error(what) {}
};

template <class Graph>
typename Graph::NodeRef only_successor(const Graph& graph, const typename Graph::NodeRef& node, Event event)
{
    std::vector<typename Graph::NodeRef> successors = graph.afters(node, event);
    if (successors.size() != 1)
        throw InvariantViolation("expected exactly one successor per event in the normalised guard, found " +
                                 std::to_string(successors.size()));
    return successors.front();
}

template <class Graph>
std::vector<Event> permitted_actions(const Graph& graph, const typename Graph::NodeRef& node, const Alphabets& alphabets)
{
    std::vector<Event> permitted;
    for (Event event : graph.initials(node))
        if (alphabets.actions.count(event))
            permitted.push_back(event);
    std::sort(permitted.begin(), permitted.end());
    permitted.erase(std::unique(permitted.begin(), permitted.end()), permitted.end());
    return permitted;
}

/// Processes one attempted action and returns the new current node.
///
/// A beats R: the refusal is only taken when the attempt is not enabled, which
/// is the runtime counterpart of prioritise(System, <A, R>).  When several R
/// events are on offer the smallest event id is followed, so runs are
/// reproducible.
template <class Graph>
typename Graph::NodeRef step(const Graph& graph, const typename Graph::NodeRef& current, Event attempt,
                             const Alphabets& alphabets, Outcome& outcome)
{
    if (!alphabets.actions.count(attempt))
        throw std::invalid_argument("attempted event is not in A");

    std::vector<Event> initials = graph.initials(current);
    std::sort(initials.begin(), initials.end());
    if (std::binary_search(initials.begin(), initials.end(), TAU_EVENT))
        throw InvariantViolation("current node offers tau; the guard is not normalised");

    outcome = Outcome();
    if (std::binary_search(initials.begin(), initials.end(), attempt))
    {
        typename Graph::NodeRef next = only_successor(graph, current, attempt);
        outcome.allowed = true;
        outcome.permitted = permitted_actions(graph, next, alphabets);
        return next;
    }

    for (Event event : initials)
    {
        if (!alphabets.refusals.count(event))
            continue;
        typename Graph::NodeRef next = only_successor(graph, current, event);
        outcome.refusal = event;
        outcome.permitted = permitted_actions(graph, next, alphabets);
        return next;
    }
    throw InvariantViolation("attempt not enabled and no R event offered: the guard would deadlock");
}

}  // namespace guard
