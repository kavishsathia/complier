// complier-fdr: FDR's side of complier's daemon. FDR loads a policy, proves it and compiles it into
// the automaton the daemon walks; complier never interprets CSP itself.
//
//   complier-fdr compile SPEC.csp [--max-states N]
//
// SPEC.csp defines `Role` and `Act` (datatypes) and `Policy`, a process over the prelude's channels
// attempt, allow, deny : Role.Act, usually built from Permit, Deny and PermitIf. It may also hold
// its own assertions (over `System`, the prioritised agents-and-monitor composition). complier-fdr
// appends the prelude, then:
//
//   1. admission: the policy answers every attempt it takes with allow or deny
//      (ComplierHandshake [FD= Policy), System can't deadlock, Policy is deterministic, and every
//      assertion in SPEC.csp passes. A failure comes back with FDR's counterexample trace.
//   2. compilation: normal(Policy), walked breadth first. The daemon gets every state and transition.
//      A refusal (an attempt the current state doesn't offer) leaves the state where it is, which is
//      what Monitor(Policy) = Policy ||| RUN({|refuse|}) under prioritise means; so the automaton
//      needs no refuse edges, only the policy's own.
//
// Prints one JSON object on stdout. Exit codes: 0 admitted, 2 usage, 3 no FDR licence, 4 the spec
// doesn't load or compile, 5 not admitted, 6 the compiled policy broke an invariant (not normalised,
// an event outside attempt/allow/deny, too many states).
//
// FDR is not part of complier: build this against your own FDR install and licence (fdr/README.md).
#include <fdr/fdr.h>

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

namespace
{
enum ExitCode
{
    EXIT_ADMITTED = 0,
    EXIT_USAGE = 2,
    EXIT_NO_LICENSE = 3,
    EXIT_LOAD_ERROR = 4,
    EXIT_NOT_ADMITTED = 5,
    EXIT_INVARIANT = 6,
};

// The prelude every spec is loaded with: the paper's encoding, as CSPm.
const char* const PRELUDE = R"csp(
-- complier prelude, appended to the spec by complier-fdr.
external prioritise
transparent normal
channel attempt, allow, deny : Role.Act
channel refuse : Role
-- Policy combinators: a policy that takes an attempt answers it.
Permit(r, x, P) = attempt.r.x -> allow.r.x -> P
Deny(r, x, P) = attempt.r.x -> deny.r.x -> P
PermitIf(r, x, c, P, Q) = attempt.r.x -> (if c then allow.r.x -> P else deny.r.x -> Q)
-- The most general agent in role r: it may attempt any action, or nothing, and is always refusable.
ControllableCHAOS(r) = (STOP |~| (|~| x:Act @ attempt.r.x -> ComplierAwait(r, x))) [] (refuse.r -> ControllableCHAOS(r))
ComplierAwait(r, x) = allow.r.x -> ControllableCHAOS(r) [] deny.r.x -> ControllableCHAOS(r)
Monitor(W) = W ||| RUN({|refuse|})
Agents = ||| r:Role @ ControllableCHAOS(r)
-- A refusal happens only when no attempt can.
System = prioritise(Agents [| {|attempt, allow, deny, refuse|} |] Monitor(Policy), <{|attempt|}, {|refuse|}>)
-- What a well-formed policy may do: take an attempt and then answer exactly it.
ComplierHandshake = STOP |~| SKIP |~| (|~| r:Role @ |~| x:Act @ attempt.r.x -> (allow.r.x -> ComplierHandshake |~| deny.r.x -> ComplierHandshake))
)csp";

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
            case '\r': out += "\\r"; break;
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

std::string json_quoted(const std::string& text) { return "\"" + json_escape(text) + "\""; }

std::string json_list(const std::vector<std::string>& items)
{
    std::string out = "[";
    for (size_t i = 0; i < items.size(); ++i)
        out += (i ? "," : "") + json_quoted(items[i]);
    return out + "]";
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

struct Check
{
    std::string what;     // what it means for the policy
    std::string text;     // the assertion as FDR prints it
    bool passed;
    std::string detail;   // the counterexample trace, or an error
};

class Compiler
{
public:
    explicit Compiler(std::shared_ptr<FDR::Session> session) : session_(session) {}

    int run(const std::string& spec_path, size_t max_states)
    {
        int code = load(spec_path);
        if (code == EXIT_ADMITTED)
            code = admit();
        if (code == EXIT_ADMITTED)
            code = compile(max_states);
        print(code);
        return code;
    }

private:
    std::string event_name(FDR::LTS::CompiledEvent event) const
    {
        if (event == FDR::LTS::TAU)
            return "τ";
        return session_->uncompile_event(event)->to_string();
    }

    void fail(const std::string& stage, const std::string& message)
    {
        error_stage_ = stage;
        error_ = message;
    }

    int load(const std::string& spec_path)
    {
        std::ifstream in(spec_path);
        if (!in)
        {
            fail("load", "cannot read " + spec_path);
            return EXIT_LOAD_ERROR;
        }
        std::stringstream text;
        text << in.rdbuf() << "\n" << PRELUDE;
        try
        {
            warnings_ = session_->load_strings_as_file(spec_path, {{spec_path, text.str()}});
            roles_ = members("Role");
            acts_ = members("Act");
        }
        catch (const FDR::Error& error)
        {
            fail("load", error.what());
            return EXIT_LOAD_ERROR;
        }
        if (roles_.empty() || acts_.empty())
        {
            fail("load", "Role and Act must each have at least one value");
            return EXIT_LOAD_ERROR;
        }
        return EXIT_ADMITTED;
    }

    // The values of a set, as FDR prints them: `{a, b}` -> [a, b].
    std::vector<std::string> members(const std::string& set)
    {
        std::string value = session_->evaluate_expression("seq(" + set + ")", nullptr).result();
        std::vector<std::string> out;
        if (value.size() < 2)
            return out;
        std::string inner = value.substr(1, value.size() - 2);  // strip < >
        std::stringstream parts(inner);
        std::string part;
        while (std::getline(parts, part, ','))
        {
            size_t a = part.find_first_not_of(' '), b = part.find_last_not_of(' ');
            if (a != std::string::npos)
                out.push_back(part.substr(a, b - a + 1));
        }
        return out;
    }

    std::string counterexample(const FDR::Assertions::Assertion& assertion) const
    {
        for (const auto& c : assertion.counterexamples())
        {
            std::shared_ptr<FDR::Assertions::Behaviour> behaviour;
            FDR::LTS::CompiledEvent extra = FDR::LTS::INVALID_EVENT;
            if (auto p = std::dynamic_pointer_cast<FDR::Assertions::PropertyCounterexample>(c))
                behaviour = p->behaviour();
            else if (auto r = std::dynamic_pointer_cast<FDR::Assertions::RefinementCounterexample>(c))
            {
                behaviour = r->implementation_behaviour();
                if (auto t = std::dynamic_pointer_cast<FDR::Assertions::TraceCounterexample>(c))
                    extra = t->error_event();
            }
            if (!behaviour)
                continue;
            std::string trace;
            for (FDR::LTS::CompiledEvent event : behaviour->trace())
                if (event != FDR::LTS::INVALID_EVENT)
                    trace += (trace.empty() ? "" : ", ") + event_name(event);
            std::string out = "trace <" + trace + ">";
            if (extra != FDR::LTS::INVALID_EVENT)
                out += " then " + event_name(extra);
            return out;
        }
        return "";
    }

    bool check(const std::string& what, const std::shared_ptr<FDR::Assertions::Assertion>& assertion)
    {
        Check c{what, assertion->to_string(), false, ""};
        try
        {
            assertion->execute(nullptr);
            c.passed = assertion->passed();
            if (!c.passed)
                c.detail = counterexample(*assertion);
        }
        catch (const FDR::Error& error)
        {
            c.detail = error.what();
        }
        checks_.push_back(c);
        return c.passed;
    }

    bool check(const std::string& what, const std::string& text)
    {
        try
        {
            return check(what, session_->parse_assertion(text).result());
        }
        catch (const FDR::Error& error)
        {
            checks_.push_back(Check{what, text, false, error.what()});
            return false;
        }
    }

    int admit()
    {
        // Every check runs, so the report says everything that's wrong at once.
        bool ok = check("every attempt the policy takes is answered with allow or deny", "ComplierHandshake [FD= Policy");
        ok = check("no agent is left waiting for a verdict (System can't deadlock)", "System :[deadlock free [F]]") && ok;
        ok = check("the policy is deterministic, so each verdict is determined", "Policy :[deterministic [FD]]") && ok;
        for (const auto& assertion : session_->assertions())
            ok = check("the spec's own assertion", assertion) && ok;
        return ok ? EXIT_ADMITTED : EXIT_NOT_ADMITTED;
    }

    int compile(size_t max_states)
    {
        std::shared_ptr<FDR::LTS::Machine> machine;
        try
        {
            machine = session_->evaluate_process("normal(Policy)", FDR::LTS::SemanticModel::Failures, nullptr).result();
        }
        catch (const FDR::Error& error)
        {
            fail("compile", error.what());
            return EXIT_LOAD_ERROR;
        }

        std::unordered_map<NodePtr, size_t, NodeHash, NodeEqual> index;
        std::vector<NodePtr> nodes;
        std::deque<NodePtr> queue;
        NodePtr root = machine->root_node();
        index[root] = 0;
        nodes.push_back(root);
        queue.push_back(root);
        while (!queue.empty())
        {
            NodePtr node = queue.front();
            queue.pop_front();
            size_t from = index[node];
            for (const FDR::LTS::Transition& transition : machine->transitions(*node))
            {
                FDR::LTS::CompiledEvent event = transition.event();
                std::string name = event_name(event);
                if (event == FDR::LTS::TAU || machine->afters(*node, event).size() != 1)
                {
                    fail("compile", "normal(Policy) isn't normalised at state " + std::to_string(from));
                    return EXIT_INVARIANT;
                }
                bool protocol = name.compare(0, 8, "attempt.") == 0 || name.compare(0, 6, "allow.") == 0 ||
                                name.compare(0, 5, "deny.") == 0 || name == "✓";
                if (!protocol)
                {
                    fail("compile", "the policy performs " + name +
                                        "; a policy may only use attempt, allow and deny (and terminate)");
                    return EXIT_INVARIANT;
                }
                const NodePtr& destination = transition.destination();
                auto found = index.find(destination);
                size_t to;
                if (found != index.end())
                    to = found->second;
                else
                {
                    if (nodes.size() >= max_states)
                    {
                        fail("compile", "the policy has more than " + std::to_string(max_states) + " states");
                        return EXIT_INVARIANT;
                    }
                    to = nodes.size();
                    index[destination] = to;
                    nodes.push_back(destination);
                    queue.push_back(destination);
                }
                transitions_.push_back("{\"from\":" + std::to_string(from) + ",\"event\":" + json_quoted(name) +
                                       ",\"to\":" + std::to_string(to) + "}");
            }
        }
        for (const NodePtr& node : nodes)
        {
            std::shared_ptr<FDR::Evaluator::ProcessName> label = session_->machine_node_name(*machine, *node);
            states_.push_back(label ? label->to_string() : "");
        }
        return EXIT_ADMITTED;
    }

    void print(int code) const
    {
        std::ostringstream out;
        out << "{\"fdr\":" << json_quoted(FDR::version()) << ",\"admitted\":" << (code == EXIT_ADMITTED ? "true" : "false");
        if (!error_.empty())
            out << ",\"error\":{\"stage\":" << json_quoted(error_stage_) << ",\"message\":" << json_quoted(error_) << "}";
        out << ",\"warnings\":" << json_list(warnings_) << ",\"roles\":" << json_list(roles_)
            << ",\"acts\":" << json_list(acts_) << ",\"checks\":[";
        for (size_t i = 0; i < checks_.size(); ++i)
        {
            const Check& c = checks_[i];
            out << (i ? "," : "") << "{\"what\":" << json_quoted(c.what) << ",\"assertion\":" << json_quoted(c.text)
                << ",\"passed\":" << (c.passed ? "true" : "false") << ",\"detail\":" << json_quoted(c.detail) << "}";
        }
        out << "]";
        if (code == EXIT_ADMITTED)
        {
            out << ",\"automaton\":{\"root\":0,\"states\":" << json_list(states_) << ",\"transitions\":[";
            for (size_t i = 0; i < transitions_.size(); ++i)
                out << (i ? "," : "") << transitions_[i];
            out << "]}";
        }
        out << "}";
        std::cout << out.str() << std::endl;
    }

    std::shared_ptr<FDR::Session> session_;
    std::vector<std::string> warnings_, roles_, acts_, states_, transitions_;
    std::vector<Check> checks_;
    std::string error_stage_, error_;
};

int usage()
{
    std::cerr << "usage: complier-fdr compile SPEC.csp [--max-states N]\n"
                 "  SPEC defines Role and Act (datatypes) and Policy over attempt, allow, deny : Role.Act.\n";
    return EXIT_USAGE;
}

int real_main(int argc, char** argv)
{
    if (argc < 3 || std::string(argv[1]) != "compile")
        return usage();
    std::string spec = argv[2];
    size_t max_states = 100000;
    for (int i = 3; i < argc; ++i)
    {
        std::string arg = argv[i];
        if (arg == "--max-states" && i + 1 < argc)
            max_states = std::stoul(argv[++i]);
        else
            return usage();
    }
    if (!FDR::has_valid_license())
    {
        std::cout << "{\"fdr\":" << json_quoted(FDR::version())
                  << ",\"admitted\":false,\"error\":{\"stage\":\"license\",\"message\":\"FDR has no valid licence. "
                     "complier uses your own copy of FDR: run `refines` or FDR once to get a licence (free for "
                     "academic and personal research; see https://cocotec.io/fdr/licensing.html).\"}}"
                  << std::endl;
        return EXIT_NO_LICENSE;
    }
    Compiler compiler(std::make_shared<FDR::Session>());
    return compiler.run(spec, max_states);
}

}  // namespace

int main(int argc, char** argv)
{
    FDR::library_init(&argc, &argv);
    int code = real_main(argc, argv);
    FDR::library_exit();
    return code;
}
