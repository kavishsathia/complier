// guard_driver: drive an FDR-compiled ControllableCHAOS guard from outside FDR.
//
// Startup: load a CSPm script, evaluate the agreed names A, R and Policy, check
// A/R disjointness and the deadlock-freedom assertions, wrap Policy, compile
// normal(...) to an LTS and point at its root node.  The wrapper is
// Policy ||| RefusalLoop(R): a refusal moves only the refusal loop, so Policy
// keeps its state.  --construction reset selects the historical wrapper
// Policy /\ refusal loop (a refusal restarts Policy), kept for comparison.
// Then read attempted A events, one per line, from --attempts FILE or stdin and
// apply guard::step.  All output is JSON lines on stdout.
//
// Only APIs declared in FDR 4.2.7's include/fdr headers are used.
#include <fdr/fdr.h>

#include <cctype>
#include <cstdio>
#include <deque>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "guard_step.h"

namespace
{
enum ExitCode
{
    EXIT_OK = 0,
    EXIT_USAGE = 2,
    EXIT_NO_LICENSE = 3,
    EXIT_LOAD_ERROR = 4,
    EXIT_ADMISSION_REFUSED = 5,
    EXIT_INVARIANT = 6,
};

const char* const ROOT_FILE = "guard_driver_root.csp";

// The user's constructions, renamed so they cannot clash with the policy script.
const char* const CONSTRUCTION = R"csp(
-- Appended by guard_driver: ControllableCHAOS construction (sections 2 and 4).
transparent normal
external prioritise
GuardDriverCHAOS(AA, RR) =
    (STOP |~| (|~| x:AA @ x -> GuardDriverCHAOS(AA, RR)))
    [] ([] r:RR @ r -> GuardDriverCHAOS(AA, RR))
-- Current: refusal interleaves with the policy and preserves its state.
GuardDriverRefusalLoop(RR) = [] r:RR @ r -> GuardDriverRefusalLoop(RR)
GuardDriverInterleaved(PP, RR) = PP ||| GuardDriverRefusalLoop(RR)
-- Historical comparison: refusal interrupts and restarts the policy.
GuardDriverControlled(PP, RR) = PP /\ ([] r:RR @ r -> GuardDriverControlled(PP, RR))
)csp";

std::string guard_expression(const std::string& construction)
{
    return construction == "reset" ? "GuardDriverControlled(Policy, R)" : "GuardDriverInterleaved(Policy, R)";
}

using NodePtr = std::shared_ptr<FDR::LTS::Node>;

struct NodeHash
{
    size_t operator()(const NodePtr& node) const { return node->hash_code(); }
};

struct NodeEqual
{
    bool operator()(const NodePtr& a, const NodePtr& b) const { return *a == *b; }
};

/// Adapts an FDR machine to the Graph interface used by guard::step.
struct FdrGraph
{
    using NodeRef = NodePtr;
    const FDR::LTS::Machine& machine;

    std::vector<guard::Event> initials(const NodeRef& node) const { return machine.initials(*node); }
    std::vector<NodeRef> afters(const NodeRef& node, guard::Event event) const
    {
        return machine.afters(*node, event);
    }
};

std::string json_escape(const std::string& text)
{
    std::string out;
    for (char c : text)
    {
        switch (c)
        {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\t': out += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20)
                {
                    char buf[8];
                    std::snprintf(buf, sizeof buf, "\\u%04x", c);
                    out += buf;
                }
                else
                    out += c;
        }
    }
    return out;
}

std::string quoted(const std::string& text) { return "\"" + json_escape(text) + "\""; }

std::string json_list(const std::vector<std::string>& items)
{
    std::string out = "[";
    for (size_t i = 0; i < items.size(); ++i)
        out += (i ? "," : "") + quoted(items[i]);
    return out + "]";
}

void emit(const std::string& line) { std::cout << line << std::endl; }

void emit_check(const std::string& check, const std::string& detail, bool ok)
{
    emit("{\"type\":\"admission\",\"check\":" + quoted(check) + ",\"detail\":" + quoted(detail) +
         ",\"ok\":" + (ok ? "true" : "false") + "}");
}

std::string lower(std::string text)
{
    for (char& c : text)
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return text;
}

class Driver
{
public:
    Driver(std::shared_ptr<FDR::Session> session, const std::string& construction)
        : session_(session), construction_(construction), guard_text_(guard_expression(construction))
    {
    }

    int run(const std::string& script_path, std::istream& attempts, const std::string& export_path,
            size_t max_states)
    {
        int code = load(script_path);
        if (code != EXIT_OK)
            return code;
        code = admit();
        if (code != EXIT_OK)
            return code;
        code = compile(export_path, max_states);
        if (code != EXIT_OK)
            return code;
        return drive(attempts);
    }

private:
    std::string name(guard::Event event) const { return session_->uncompile_event(event)->to_string(); }

    std::vector<std::string> names(const std::vector<guard::Event>& events) const
    {
        std::vector<std::string> out;
        for (guard::Event event : events)
            out.push_back(name(event));
        return out;
    }

    std::string node_label(const NodePtr& node) const
    {
        std::shared_ptr<FDR::Evaluator::ProcessName> process_name = session_->machine_node_name(*guard_, *node);
        return process_name ? process_name->to_string() : "";
    }

    int load(const std::string& script_path)
    {
        std::ifstream in(script_path);
        if (!in)
        {
            emit("{\"type\":\"error\",\"stage\":\"load\",\"message\":" + quoted("cannot read " + script_path) + "}");
            return EXIT_LOAD_ERROR;
        }
        std::stringstream text;
        text << in.rdbuf() << "\n" << CONSTRUCTION;
        try
        {
            std::vector<std::string> warnings =
                session_->load_strings_as_file(ROOT_FILE, {{ROOT_FILE, text.str()}});
            emit("{\"type\":\"loaded\",\"script\":" + quoted(script_path) + ",\"warnings\":" + json_list(warnings) +
                 "}");
        }
        catch (const FDR::FileLoadError& error)
        {
            emit("{\"type\":\"error\",\"stage\":\"load\",\"message\":" + quoted(error.what()) + "}");
            return EXIT_LOAD_ERROR;
        }
        return EXIT_OK;
    }

    bool expression_is_true(const std::string& expression)
    {
        std::string value = session_->evaluate_expression(expression, nullptr).result();
        bool ok = lower(value) == "true";
        emit_check(expression, value, ok);
        return ok;
    }

    bool assertion_passes(const std::string& text, bool required)
    {
        std::shared_ptr<FDR::Assertions::Assertion> assertion = session_->parse_assertion(text).result();
        assertion->execute(nullptr);
        bool passed = assertion->passed();
        emit_check(assertion->to_string(), passed ? "passed" : "failed", passed || !required);
        return passed;
    }

    /// Names of all events a process over the given set can perform.
    std::vector<std::string> event_names(const std::string& set_expression)
    {
        std::shared_ptr<FDR::LTS::Machine> run = session_
            ->evaluate_process("RUN(" + set_expression + ")", FDR::LTS::SemanticModel::Traces, nullptr)
            .result();
        return names(run->alphabet(false));
    }

    int admit()
    {
        try
        {
            if (!expression_is_true("card(A) > 0 and card(R) > 0") || !expression_is_true("empty(inter(A, R))"))
                return EXIT_ADMISSION_REFUSED;
            std::string system = "GuardDriverCHAOS(A, R) [| union(A, R) |] " + guard_text_;
            if (!assertion_passes(system + " :[deadlock free [F]]", true))
                return EXIT_ADMISSION_REFUSED;
            // Priority sits on the whole agent-guard composition.
            if (!assertion_passes("prioritise(" + system + ", <A, R>) :[deadlock free [F]]", true))
                return EXIT_ADMISSION_REFUSED;
            // Reported, not required: with a nondeterministic Policy the normalised
            // guard allows an attempt if *some* resolution allows it.
            assertion_passes(guard_text_ + " :[deterministic [F]]", false);
            action_names_ = event_names("A");
            refusal_names_ = event_names("R");
        }
        catch (const FDR::Error& error)
        {
            emit("{\"type\":\"error\",\"stage\":\"admission\",\"message\":" + quoted(error.what()) + "}");
            return EXIT_ADMISSION_REFUSED;
        }
        return EXIT_OK;
    }

    int compile(const std::string& export_path, size_t max_states)
    {
        try
        {
            guard_ = session_
                ->evaluate_process("normal(" + guard_text_ + ")", FDR::LTS::SemanticModel::Failures, nullptr)
                .result();
        }
        catch (const FDR::Error& error)
        {
            emit("{\"type\":\"error\",\"stage\":\"compile\",\"message\":" + quoted(error.what()) + "}");
            return EXIT_LOAD_ERROR;
        }

        // Classify the guard's events by name; A events the guard never performs get
        // fresh ids that no node offers, so attempting them is always refused.
        std::map<std::string, guard::Event> guard_events;
        for (guard::Event event : guard_->alphabet(false))
            guard_events[name(event)] = event;
        guard::Event fresh = 0x80000000u;
        for (const std::string& action : action_names_)
        {
            auto found = guard_events.find(action);
            guard::Event event = found != guard_events.end() ? found->second : fresh++;
            action_ids_[action] = event;
            alphabets_.actions.insert(event);
        }
        for (const std::string& refusal : refusal_names_)
        {
            auto found = guard_events.find(refusal);
            if (found != guard_events.end())
                alphabets_.refusals.insert(found->second);
        }
        for (const auto& entry : guard_events)
        {
            if (!alphabets_.actions.count(entry.second) && !alphabets_.refusals.count(entry.second))
            {
                emit_check("guard alphabet within A and R", "event outside A and R: " + entry.first, false);
                return EXIT_ADMISSION_REFUSED;
            }
        }

        root_ = guard_->root_node();
        return explore(export_path, max_states);
    }

    /// Breadth-first walk of the reachable guard, checking the runtime invariants
    /// and optionally exporting the automaton.
    int explore(const std::string& export_path, size_t max_states)
    {
        std::vector<NodePtr> nodes;
        std::vector<std::string> transitions;
        std::deque<NodePtr> queue;
        index_[root_] = 0;
        nodes.push_back(root_);
        queue.push_back(root_);
        bool complete = true;
        // Where each R transition of the compiled guard leads: back to the same
        // node (state preserved), to the root (policy restarted) or elsewhere.
        size_t refuse_self = 0, refuse_root = 0, refuse_other = 0;
        while (!queue.empty())
        {
            NodePtr node = queue.front();
            queue.pop_front();
            bool offers_refusal = false;
            for (const FDR::LTS::Transition& transition : guard_->transitions(*node))
            {
                guard::Event event = transition.event();
                if (event == FDR::LTS::TAU || guard_->afters(*node, event).size() != 1)
                {
                    emit("{\"type\":\"error\",\"stage\":\"explore\",\"message\":" +
                         quoted("guard is not normalised at node " + std::to_string(index_[node])) + "}");
                    return EXIT_INVARIANT;
                }
                offers_refusal = offers_refusal || alphabets_.refusals.count(event);
                const NodePtr& destination = transition.destination();
                auto found = index_.find(destination);
                size_t target;
                if (found != index_.end())
                    target = found->second;
                else if (nodes.size() < max_states)
                {
                    target = nodes.size();
                    index_[destination] = target;
                    nodes.push_back(destination);
                    queue.push_back(destination);
                }
                else
                {
                    complete = false;
                    continue;
                }
                if (alphabets_.refusals.count(event))
                {
                    if (target == index_[node])
                        ++refuse_self;
                    else if (target == 0)
                        ++refuse_root;
                    else
                        ++refuse_other;
                }
                transitions.push_back("{\"from\":" + std::to_string(index_[node]) + ",\"event\":" + quoted(name(event)) +
                                      ",\"to\":" + std::to_string(target) + "}");
            }
            if (!offers_refusal)
            {
                emit("{\"type\":\"error\",\"stage\":\"explore\",\"message\":" +
                     quoted("node " + std::to_string(index_[node]) + " offers no R event") + "}");
                return EXIT_INVARIANT;
            }
        }
        emit("{\"type\":\"compiled\",\"construction\":" + quoted(construction_) + ",\"process\":" +
             quoted("normal(" + guard_text_ + ")") + ",\"nodes\":" + std::to_string(nodes.size()) + ",\"transitions\":" + std::to_string(transitions.size()) +
             ",\"complete\":" + (complete ? "true" : "false") + ",\"refuse_edges\":{\"self_loop\":" +
             std::to_string(refuse_self) + ",\"to_root\":" + std::to_string(refuse_root) +
             ",\"elsewhere\":" + std::to_string(refuse_other) + "},\"root_permitted\":" +
             json_list(names(guard::permitted_actions(FdrGraph{*guard_}, root_, alphabets_))) + "}");

        if (!export_path.empty())
        {
            std::ofstream out(export_path);
            out << "{\"construction\":" << quoted(construction_) << ",\"root\":0,\"complete\":" << (complete ? "true" : "false") << ",\"actions\":"
                << json_list(action_names_) << ",\"refusals\":" << json_list(refusal_names_) << ",\"nodes\":[";
            for (size_t i = 0; i < nodes.size(); ++i)
                out << (i ? "," : "") << quoted(node_label(nodes[i]));
            out << "],\"transitions\":[";
            for (size_t i = 0; i < transitions.size(); ++i)
                out << (i ? "," : "") << transitions[i];
            out << "]}\n";
        }
        return EXIT_OK;
    }

    int drive(std::istream& attempts)
    {
        FdrGraph graph{*guard_};
        NodePtr current = root_;
        std::string line;
        size_t step_number = 0;
        while (std::getline(attempts, line))
        {
            line.erase(0, line.find_first_not_of(" \t\r"));
            line.erase(line.find_last_not_of(" \t\r") + 1);
            if (line.empty() || line[0] == '#')
                continue;
            ++step_number;
            if (line == "?")
            {
                emit("{\"type\":\"permitted\",\"step\":" + std::to_string(step_number) + ",\"permitted\":" +
                     json_list(names(guard::permitted_actions(graph, current, alphabets_))) + "}");
                continue;
            }
            auto found = action_ids_.find(line);
            if (found == action_ids_.end())
            {
                emit("{\"type\":\"attempt\",\"step\":" + std::to_string(step_number) + ",\"attempt\":" + quoted(line) +
                     ",\"decision\":\"error\",\"reason\":\"not an event of A\"}");
                continue;
            }
            guard::Outcome outcome;
            NodePtr before = current;
            try
            {
                current = guard::step(graph, current, found->second, alphabets_, outcome);
            }
            catch (const guard::InvariantViolation& error)
            {
                emit("{\"type\":\"error\",\"stage\":\"drive\",\"message\":" + quoted(error.what()) + "}");
                return EXIT_INVARIANT;
            }
            std::string record = "{\"type\":\"attempt\",\"step\":" + std::to_string(step_number) + ",\"attempt\":" +
                                 quoted(line) + ",\"decision\":" + (outcome.allowed ? "\"allow\"" : "\"refuse\"");
            if (!outcome.allowed)
                record += ",\"refusal_event\":" + quoted(name(outcome.refusal)) + ",\"state_preserved\":" +
                          (*current == *before ? "true" : "false");
            auto id = index_.find(current);
            record += ",\"node_id\":" + (id != index_.end() ? std::to_string(id->second) : std::string("null")) +
                      ",\"node\":" + quoted(node_label(current)) + ",\"at_root\":" +
                      (*current == *root_ ? "true" : "false") + ",\"permitted\":" + json_list(names(outcome.permitted)) +
                      "}";
            emit(record);
        }
        return EXIT_OK;
    }

    std::shared_ptr<FDR::Session> session_;
    std::string construction_;
    std::string guard_text_;
    std::shared_ptr<FDR::LTS::Machine> guard_;
    NodePtr root_;
    std::unordered_map<NodePtr, size_t, NodeHash, NodeEqual> index_;  // node -> id in the export
    std::vector<std::string> action_names_;
    std::vector<std::string> refusal_names_;
    std::map<std::string, guard::Event> action_ids_;
    guard::Alphabets alphabets_;
};

int usage()
{
    std::cerr << "usage: guard_driver SCRIPT.csp [--construction interleave|reset] [--attempts FILE]\n"
                 "                    [--export FILE.json] [--max-states N]\n"
                 "  interleave (default): Policy ||| refusal loop, a refusal keeps Policy's state;\n"
                 "  reset (historical comparison): Policy /\\ refusal loop, a refusal restarts Policy.\n"
                 "  SCRIPT must define A, R :: {Event} and Policy :: Proc.\n"
                 "  Attempts are CSPm event names, one per line; '?' lists permitted actions.\n";
    return EXIT_USAGE;
}

int real_main(int argc, char** argv)
{
    std::string script, attempts_path, export_path, construction = "interleave";
    size_t max_states = 100000;
    for (int i = 1; i < argc; ++i)
    {
        std::string arg = argv[i];
        if ((arg == "--attempts" || arg == "--export" || arg == "--max-states" || arg == "--construction") &&
            i + 1 < argc)
        {
            std::string value = argv[++i];
            if (arg == "--attempts")
                attempts_path = value;
            else if (arg == "--export")
                export_path = value;
            else if (arg == "--construction")
                construction = value;
            else
                max_states = std::stoul(value);
        }
        else if (script.empty() && arg[0] != '-')
            script = arg;
        else
            return usage();
    }
    if (script.empty() || (construction != "reset" && construction != "interleave"))
        return usage();

    emit("{\"type\":\"fdr\",\"version\":" + quoted(FDR::version()) + "}");
    if (!FDR::has_valid_license())
    {
        emit("{\"type\":\"error\",\"stage\":\"license\",\"message\":\"FDR::has_valid_license() is false; run "
             "refines or fdr4 interactively once to obtain a license, then rerun\"}");
        return EXIT_NO_LICENSE;
    }

    std::ifstream attempts_file;
    if (!attempts_path.empty())
    {
        attempts_file.open(attempts_path);
        if (!attempts_file)
        {
            std::cerr << "cannot read " << attempts_path << "\n";
            return EXIT_USAGE;
        }
    }
    Driver driver(std::make_shared<FDR::Session>(), construction);
    return driver.run(script, attempts_path.empty() ? std::cin : attempts_file, export_path, max_states);
}

}  // namespace

int main(int argc, char** argv)
{
    FDR::library_init(&argc, &argv);
    int code = real_main(argc, argv);
    FDR::library_exit();
    return code;
}
