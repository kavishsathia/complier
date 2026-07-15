#include "complier/error.hpp"
#include "complier/lexer.hpp"
#include "testing.hpp"

#include <vector>

using complier::ParseError;
using complier::lex::lex;
using complier::lex::Token;
using complier::lex::TokenKind;

namespace {

std::vector<TokenKind> kinds(const std::vector<Token>& tokens) {
    std::vector<TokenKind> out;
    for (const auto& t : tokens) out.push_back(t.kind);
    return out;
}

}  // namespace

TEST(lexes_a_flat_workflow) {
    auto tokens = lex(
        "workflow \"deploy\"\n"
        "    | @llm \"ship it\"\n");
    std::vector<TokenKind> expected = {
        TokenKind::Workflow, TokenKind::Str,    TokenKind::Newline, TokenKind::Indent,
        TokenKind::Pipe,     TokenKind::AtLlm,  TokenKind::Str,     TokenKind::Newline,
        TokenKind::Dedent,   TokenKind::Eof,
    };
    CHECK_EQ(kinds(tokens), expected);
    CHECK_EQ(tokens[1].text, "deploy");
    CHECK_EQ(tokens[6].text, "ship it");
}

TEST(decodes_string_escapes) {
    auto tokens = lex("guarantee g [x]\nworkflow \"a\\\"b\\n\\t\\\\c\"\n    | t\n");
    CHECK_EQ(tokens[5].kind, TokenKind::Str);
    CHECK_EQ(tokens[5].text, "a\"b\n\t\\c");
}

TEST(strips_prompt_delimiters) {
    auto tokens = lex("tool a=(be careful) b=[looks right] c={ok to ship} d=`n > 3`\n");
    CHECK_EQ(tokens[3].kind, TokenKind::HintPrompt);
    CHECK_EQ(tokens[3].text, "be careful");
    CHECK_EQ(tokens[6].kind, TokenKind::ModelPrompt);
    CHECK_EQ(tokens[6].text, "looks right");
    CHECK_EQ(tokens[9].kind, TokenKind::HumanPrompt);
    CHECK_EQ(tokens[9].text, "ok to ship");
    CHECK_EQ(tokens[12].kind, TokenKind::CelExpr);
    CHECK_EQ(tokens[12].text, "n > 3");
}

TEST(recognizes_keywords_and_directives) {
    auto tokens = lex("@branch @loop @unordered -when -else -until -step halt skip true false null\n");
    std::vector<TokenKind> expected = {
        TokenKind::AtBranch, TokenKind::AtLoop, TokenKind::AtUnordered,
        TokenKind::When,     TokenKind::Else,   TokenKind::Until,
        TokenKind::StepKw,   TokenKind::Halt,   TokenKind::Skip,
        TokenKind::True,     TokenKind::False,  TokenKind::Null,
        TokenKind::Newline,  TokenKind::Eof,
    };
    CHECK_EQ(kinds(tokens), expected);
}

TEST(idents_allow_path_characters) {
    auto tokens = lex("tools/read-file.v2 retries=3\n");
    CHECK_EQ(tokens[0].kind, TokenKind::Ident);
    CHECK_EQ(tokens[0].text, "tools/read-file.v2");
    CHECK_EQ(tokens[3].kind, TokenKind::Number);
    CHECK_EQ(tokens[3].text, "3");
}

TEST(tracks_nested_indentation) {
    auto tokens = lex(
        "workflow \"w\"\n"
        "    | @branch\n"
        "        -when \"x\"\n"
        "            | a\n"
        "    | b\n");
    std::vector<TokenKind> expected = {
        TokenKind::Workflow, TokenKind::Str,     TokenKind::Newline,
        TokenKind::Indent,   TokenKind::Pipe,    TokenKind::AtBranch, TokenKind::Newline,
        TokenKind::Indent,   TokenKind::When,    TokenKind::Str,      TokenKind::Newline,
        TokenKind::Indent,   TokenKind::Pipe,    TokenKind::Ident,    TokenKind::Newline,
        TokenKind::Dedent,   TokenKind::Dedent,  TokenKind::Pipe,     TokenKind::Ident,
        TokenKind::Newline,  TokenKind::Dedent,  TokenKind::Eof,
    };
    CHECK_EQ(kinds(tokens), expected);
}

TEST(blank_lines_do_not_change_nesting) {
    auto tokens = lex(
        "workflow \"w\"\n"
        "    | a\n"
        "\n"
        "    | b\n");
    std::vector<TokenKind> expected = {
        TokenKind::Workflow, TokenKind::Str,   TokenKind::Newline, TokenKind::Indent,
        TokenKind::Pipe,     TokenKind::Ident, TokenKind::Newline,
        TokenKind::Pipe,     TokenKind::Ident, TokenKind::Newline,
        TokenKind::Dedent,   TokenKind::Eof,
    };
    CHECK_EQ(kinds(tokens), expected);
}

TEST(missing_trailing_newline_is_tolerated) {
    auto tokens = lex("workflow \"w\"\n    | a");
    CHECK_EQ(tokens[tokens.size() - 3].kind, TokenKind::Newline);
    CHECK_EQ(tokens[tokens.size() - 2].kind, TokenKind::Dedent);
    CHECK_EQ(tokens.back().kind, TokenKind::Eof);
}

TEST(reports_positions) {
    auto tokens = lex("workflow \"w\"\n    | a\n");
    CHECK_EQ(tokens[0].line, 1);
    CHECK_EQ(tokens[0].col, 1);
    CHECK_EQ(tokens[4].line, 2);  // the pipe
    CHECK_EQ(tokens[4].col, 5);
}

TEST(rejects_bad_input) {
    CHECK_THROWS(lex("workflow \"unterminated\n"));
    CHECK_THROWS(lex("tool a=[never closed\n"));
    CHECK_THROWS(lex("@nonsense\n"));
    CHECK_THROWS(lex("-nonsense\n"));
    CHECK_THROWS(lex("tool ~\n"));
    CHECK_THROWS(lex(
        "workflow \"w\"\n"
        "        | a\n"
        "    | b\n"));  // dedent to an indent level never opened
}
