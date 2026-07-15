#include "complier/parser.hpp"

#include <format>
#include <string>
#include <utility>
#include <vector>

#include "complier/error.hpp"
#include "complier/lexer.hpp"

namespace complier {

namespace {

using lex::Token;
using lex::TokenKind;

struct Parser {
    std::vector<Token> toks;
    std::size_t pos = 0;

    const Token& peek() const { return toks[pos]; }
    bool at(TokenKind kind) const { return toks[pos].kind == kind; }
    const Token& eat() { return toks[pos++]; }

    [[noreturn]] void fail(const std::string& msg) const {
        throw ParseError(msg, peek().line, peek().col);
    }

    const Token& expect(TokenKind kind, const char* what) {
        if (!at(kind))
            fail(std::format("expected {}, got {}", what, lex::token_name(peek().kind)));
        return eat();
    }

    // word-shaped keywords double as identifiers, so `halt` is a fine tool name
    bool at_name() const {
        switch (peek().kind) {
            case TokenKind::Ident:
            case TokenKind::Guarantee:
            case TokenKind::Workflow:
            case TokenKind::Halt:
            case TokenKind::Skip:
            case TokenKind::True:
            case TokenKind::False:
            case TokenKind::Null:
                return true;
            default:
                return false;
        }
    }

    std::string expect_name(const char* what) {
        if (!at_name())
            fail(std::format("expected {}, got {}", what, lex::token_name(peek().kind)));
        return eat().text;
    }

    void skip_newlines() {
        while (at(TokenKind::Newline)) eat();
    }

    ast::Program program() {
        ast::Program prog;
        skip_newlines();
        while (!at(TokenKind::Eof)) {
            if (at(TokenKind::Guarantee)) {
                prog.items.push_back(guarantee());
            } else if (at(TokenKind::Workflow)) {
                prog.items.push_back(workflow());
            } else {
                fail("expected 'guarantee' or 'workflow'");
            }
            skip_newlines();
        }
        if (prog.items.empty()) fail("contract source cannot be empty");
        return prog;
    }

    ast::Guarantee guarantee() {
        eat();
        ast::Guarantee g;
        g.name = expect_name("guarantee name");
        g.expression = verified_constraint();
        return g;
    }

    ast::Constraint verified_constraint() {
        ast::Constraint c;
        if (at(TokenKind::ModelPrompt)) {
            c.kind = ast::Constraint::Kind::Model;
        } else if (at(TokenKind::HumanPrompt)) {
            c.kind = ast::Constraint::Kind::Human;
        } else if (at(TokenKind::CelExpr)) {
            c.kind = ast::Constraint::Kind::Cel;
        } else {
            fail("expected a [model], {human} or `cel` constraint");
        }
        c.text = eat().text;
        if (at(TokenKind::Colon)) {
            eat();
            c.policy = policy();
        }
        return c;
    }

    ast::Policy policy() {
        if (at(TokenKind::Halt)) {
            eat();
            return {ast::Policy::Kind::Halt, 0};
        }
        if (at(TokenKind::Skip)) {
            eat();
            return {ast::Policy::Kind::Skip, 0};
        }
        if (at(TokenKind::Number)) return {ast::Policy::Kind::Retry, std::stoi(eat().text)};
        fail("expected 'halt', 'skip' or a retry count");
    }

    ast::Workflow workflow() {
        eat();
        ast::Workflow wf;
        wf.name = expect(TokenKind::Str, "a workflow name string").text;
        while (true) {
            if (at(TokenKind::AtAlways)) {
                eat();
                wf.always.push_back(expect_name("a guarantee name"));
            } else if (at(TokenKind::AtAmbient)) {
                eat();
                if (!at_name()) fail("expected at least one tool name after @ambient");
                while (at_name()) wf.ambient.push_back(eat().text);
            } else {
                break;
            }
        }
        expect(TokenKind::Newline, "end of line");
        expect(TokenKind::Indent, "an indented step block");
        wf.steps = steps();
        expect(TokenKind::Dedent, "end of step block");
        return wf;
    }

    std::vector<ast::Step> steps() {
        if (!at(TokenKind::Pipe)) fail("expected a '|' step");
        std::vector<ast::Step> out;
        while (at(TokenKind::Pipe)) out.push_back(step());
        return out;
    }

    ast::Step step() {
        eat();  // the pipe
        switch (peek().kind) {
            case TokenKind::AtLlm: {
                eat();
                std::string prompt = expect(TokenKind::Str, "a prompt string").text;
                end_of_line();
                return {ast::LlmStep{std::move(prompt)}};
            }
            case TokenKind::AtHuman: {
                eat();
                std::string prompt = expect(TokenKind::Str, "a prompt string").text;
                end_of_line();
                return {ast::HumanStep{std::move(prompt)}};
            }
            case TokenKind::AtCall:
            case TokenKind::AtUse:
            case TokenKind::AtInline: {
                ast::SubworkflowStep sub = subworkflow();
                end_of_line();
                return {std::move(sub)};
            }
            case TokenKind::AtFork: {
                eat();
                ast::ForkStep fork;
                fork.fork_id = expect_name("a fork id");
                fork.target = subworkflow();
                end_of_line();
                return {std::move(fork)};
            }
            case TokenKind::AtJoin: {
                eat();
                ast::JoinStep join;
                join.fork_id = expect_name("a fork id");
                end_of_line();
                return {std::move(join)};
            }
            case TokenKind::AtBranch: return {branch()};
            case TokenKind::AtLoop: return {loop()};
            case TokenKind::AtUnordered: return {unordered()};
            default: break;
        }
        if (!at_name()) fail("expected a step");
        ast::ToolStep tool = tool_step();
        end_of_line();
        return {std::move(tool)};
    }

    void end_of_line() { expect(TokenKind::Newline, "end of line"); }

    ast::SubworkflowStep subworkflow() {
        ast::SubworkflowStep sub;
        if (at(TokenKind::AtCall)) sub.call_type = ast::CallType::Call;
        else if (at(TokenKind::AtUse)) sub.call_type = ast::CallType::Use;
        else if (at(TokenKind::AtInline)) sub.call_type = ast::CallType::Inline;
        else fail("expected @call, @use or @inline");
        eat();
        sub.workflow_name = expect_name("a workflow name");
        return sub;
    }

    ast::ToolStep tool_step() {
        ast::ToolStep tool;
        tool.name = eat().text;
        while (!at(TokenKind::Newline)) {
            ast::Param param;
            param.name = expect_name("a parameter name");
            expect(TokenKind::Equals, "'='");
            param.value = param_value();
            tool.params.push_back(std::move(param));
        }
        return tool;
    }

    ast::ParamValue param_value() {
        switch (peek().kind) {
            case TokenKind::Str: return eat().text;
            case TokenKind::Number: return static_cast<std::int64_t>(std::stoll(eat().text));
            case TokenKind::True: eat(); return true;
            case TokenKind::False: eat(); return false;
            case TokenKind::Null: eat(); return std::monostate{};
            case TokenKind::HintPrompt: {
                ast::Constraint c;
                c.kind = ast::Constraint::Kind::Hint;
                c.text = eat().text;
                return c;
            }
            case TokenKind::ModelPrompt:
            case TokenKind::HumanPrompt:
            case TokenKind::CelExpr: return verified_constraint();
            default: fail("expected a parameter value");
        }
    }

    ast::BranchStep branch() {
        eat();
        end_of_line();
        expect(TokenKind::Indent, "an indented block of arms");
        ast::BranchStep b;
        while (at(TokenKind::When)) {
            eat();
            ast::WhenArm arm;
            arm.condition = expect(TokenKind::Str, "a condition string").text;
            end_of_line();
            expect(TokenKind::Indent, "an indented step block");
            arm.steps = steps();
            expect(TokenKind::Dedent, "end of step block");
            b.when_arms.push_back(std::move(arm));
        }
        if (b.when_arms.empty()) fail("expected at least one -when arm");
        if (at(TokenKind::Else)) {
            eat();
            end_of_line();
            expect(TokenKind::Indent, "an indented step block");
            b.else_arm = ast::ElseArm{steps()};
            expect(TokenKind::Dedent, "end of step block");
        }
        expect(TokenKind::Dedent, "end of branch block");
        return b;
    }

    ast::LoopStep loop() {
        eat();
        end_of_line();
        expect(TokenKind::Indent, "an indented step block");
        ast::LoopStep l;
        l.steps = steps();
        expect(TokenKind::Until, "'-until'");
        l.until = expect(TokenKind::Str, "a condition string").text;
        end_of_line();
        expect(TokenKind::Dedent, "end of loop block");
        return l;
    }

    ast::UnorderedStep unordered() {
        eat();
        end_of_line();
        expect(TokenKind::Indent, "an indented block of cases");
        ast::UnorderedStep u;
        while (at(TokenKind::StepKw)) {
            eat();
            ast::UnorderedCase c;
            c.label = expect(TokenKind::Str, "a case label string").text;
            end_of_line();
            expect(TokenKind::Indent, "an indented step block");
            c.steps = steps();
            expect(TokenKind::Dedent, "end of step block");
            u.cases.push_back(std::move(c));
        }
        if (u.cases.empty()) fail("expected at least one -step case");
        expect(TokenKind::Dedent, "end of unordered block");
        return u;
    }
};

}  // namespace

ast::Program parse(std::string_view source) {
    Parser parser;
    parser.toks = lex::lex(source);
    return parser.program();
}

}  // namespace complier
