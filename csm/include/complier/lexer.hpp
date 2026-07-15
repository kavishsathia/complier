#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace complier::lex {

enum class TokenKind {
    Ident,
    Number,
    Str,

    // delimited prompt forms: (hint) [model] {human} `cel`
    HintPrompt,
    ModelPrompt,
    HumanPrompt,
    CelExpr,

    Pipe,
    Equals,
    Colon,

    Guarantee,
    Workflow,
    AtAlways,
    AtAmbient,
    AtLlm,
    AtHuman,
    AtFork,
    AtJoin,
    AtCall,
    AtUse,
    AtInline,
    AtBranch,
    AtLoop,
    AtUnordered,
    When,
    Else,
    Until,
    StepKw,
    Halt,
    Skip,
    True,
    False,
    Null,

    Newline,
    Indent,
    Dedent,
    Eof,
};

struct Token {
    TokenKind kind;
    std::string text;  // ident/number spelling, decoded string, or prompt body
    int line = 0;
    int col = 0;
};

const char* token_name(TokenKind kind);

std::vector<Token> lex(std::string_view source);

}  // namespace complier::lex
