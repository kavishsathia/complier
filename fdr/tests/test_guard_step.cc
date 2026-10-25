// Self-test of guard_step.h only.
//
// The transition tables below are HAND-WRITTEN from the CSP operational
// semantics of Controlled(Policy, R) (historical reset) and of
// Policy ||| RefusalLoop(R) (current interleave).  They are NOT FDR output and say nothing
// about what FDR compiles; they only exercise the driver's step logic
// (allow/advance, block/refuse/reset, feedback, invariant errors).
#include <cstdlib>
#include <iostream>
#include <map>
#include <utility>
#include <vector>

#include "../src/guard_step.h"

namespace
{
struct TableGraph
{
    using NodeRef = int;
    std::map<std::pair<int, guard::Event>, std::vector<int>> arcs;

    std::vector<guard::Event> initials(const NodeRef& node) const
    {
        std::vector<guard::Event> out;
        for (const auto& arc : arcs)
            if (arc.first.first == node)
                out.push_back(arc.first.second);
        return out;
    }
    std::vector<NodeRef> afters(const NodeRef& node, guard::Event event) const
    {
        auto found = arcs.find({node, event});
        return found == arcs.end() ? std::vector<NodeRef>() : found->second;
    }
};

int failures = 0;

void check(bool condition, const char* what)
{
    std::cout << (condition ? "PASS " : "FAIL ") << what << "\n";
    if (!condition)
        ++failures;
}

// Event ids; 1 is reserved for tau as in FDR.
const guard::Event REQ = 10, EXEC = 11, READ = 20, WRITE = 21, TEST = 22, PUSH = 23, REFUSE = 30;

void henz_req_exec()
{
    // Policy = (req -> Policy) [] (exec -> STOP), wrapped by Controlled:
    // node 0 = Policy /\ Q, node 1 = STOP /\ Q = Q.
    TableGraph g;
    g.arcs = {{{0, REQ}, {0}}, {{0, EXEC}, {1}}, {{0, REFUSE}, {0}}, {{1, REFUSE}, {0}}};
    guard::Alphabets ab{{REQ, EXEC}, {REFUSE}};
    guard::Outcome out;

    int node = guard::step(g, 0, REQ, ab, out);
    check(out.allowed && node == 0, "req allowed at root, pointer stays at Policy");
    node = guard::step(g, node, EXEC, ab, out);
    check(out.allowed && node == 1 && out.permitted.empty(), "exec allowed, Policy reaches STOP, no A permitted");
    node = guard::step(g, node, REQ, ab, out);
    check(!out.allowed && out.refusal == REFUSE, "req blocked at STOP and refuse followed");
    check(node == 0, "refuse restarts Policy (reset, not a self-loop at STOP)");
    check(out.permitted == std::vector<guard::Event>({REQ, EXEC}), "feedback lists req, exec and drops R");
    node = guard::step(g, 0, REQ, ab, out);
    check(out.allowed && out.refusal == 0, "A beats R: enabled attempt never refuses although refuse is offered");
}

void agent_tools()
{
    // Clean = node 0, Dirty = node 1.
    TableGraph g;
    g.arcs = {{{0, READ}, {0}}, {{0, WRITE}, {1}}, {{0, TEST}, {0}}, {{0, PUSH}, {0}}, {{0, REFUSE}, {0}},
              {{1, READ}, {1}}, {{1, WRITE}, {1}}, {{1, TEST}, {0}}, {{1, REFUSE}, {0}}};
    guard::Alphabets ab{{READ, WRITE, TEST, PUSH}, {REFUSE}};
    guard::Outcome out;

    int node = guard::step(g, 0, WRITE, ab, out);
    node = guard::step(g, node, PUSH, ab, out);
    check(!out.allowed && node == 0, "push while dirty is refused and resets to Clean");
    node = guard::step(g, node, PUSH, ab, out);
    check(out.allowed, "retried push after the reset is allowed (reset-on-refusal consequence)");
}

void agent_tools_interleave()
{
    // Policy ||| RefusalLoop(R): refuse is a self-loop, so Dirty stays Dirty.
    TableGraph g;
    g.arcs = {{{0, READ}, {0}}, {{0, WRITE}, {1}}, {{0, TEST}, {0}}, {{0, PUSH}, {0}}, {{0, REFUSE}, {0}},
              {{1, READ}, {1}}, {{1, WRITE}, {1}}, {{1, TEST}, {0}}, {{1, REFUSE}, {1}}};
    guard::Alphabets ab{{READ, WRITE, TEST, PUSH}, {REFUSE}};
    guard::Outcome out;

    int node = guard::step(g, 0, WRITE, ab, out);
    node = guard::step(g, node, PUSH, ab, out);
    check(!out.allowed && node == 1, "interleave: push while dirty is refused and the guard stays Dirty");
    check(out.permitted == std::vector<guard::Event>({READ, WRITE, TEST}), "interleave: feedback is Dirty's actions");
    node = guard::step(g, node, PUSH, ab, out);
    check(!out.allowed && node == 1, "interleave: retried push is refused again");
    node = guard::step(g, node, TEST, ab, out);
    node = guard::step(g, node, PUSH, ab, out);
    check(out.allowed && node == 0, "interleave: push allowed after run_tests");
}

void invariants()
{
    guard::Alphabets ab{{REQ}, {REFUSE}};
    guard::Outcome out;

    TableGraph no_refusal;
    no_refusal.arcs = {{{0, EXEC}, {0}}};
    bool thrown = false;
    try { guard::step(no_refusal, 0, REQ, ab, out); }
    catch (const guard::InvariantViolation&) { thrown = true; }
    check(thrown, "node without an R event is reported, never silently deadlocks");

    TableGraph nondeterministic;
    nondeterministic.arcs = {{{0, REQ}, {0, 1}}, {{0, REFUSE}, {0}}};
    thrown = false;
    try { guard::step(nondeterministic, 0, REQ, ab, out); }
    catch (const guard::InvariantViolation&) { thrown = true; }
    check(thrown, "two successors for one event is rejected (guard not normalised)");

    TableGraph with_tau;
    with_tau.arcs = {{{0, guard::TAU_EVENT}, {0}}, {{0, REFUSE}, {0}}};
    thrown = false;
    try { guard::step(with_tau, 0, REQ, ab, out); }
    catch (const guard::InvariantViolation&) { thrown = true; }
    check(thrown, "tau at the current node is rejected");

    thrown = false;
    try { guard::step(with_tau, 0, REFUSE, ab, out); }
    catch (const std::invalid_argument&) { thrown = true; }
    check(thrown, "attempting an R event as an action is rejected");
}

}  // namespace

int main()
{
    henz_req_exec();
    agent_tools();
    agent_tools_interleave();
    invariants();
    std::cout << (failures ? "FAILED " : "OK ") << failures << " failure(s)\n";
    return failures ? EXIT_FAILURE : EXIT_SUCCESS;
}
