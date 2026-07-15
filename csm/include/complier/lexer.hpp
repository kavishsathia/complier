#pragma once

#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace complier::lex {

struct Workflow {};

struct Identifier {
    std::string_view name;
};

struct LeftBrace {};
struct Equal {};
struct Semicolon {};
struct RightBrace {};

struct LeftParen {};
struct RightParen {};
struct LeftBracket {};
struct RightBracket {};

struct Switch {};
struct Case {};
struct Default {};
struct Loop {};
struct While {};

struct String {
    std::string_view value;
};
struct Integer {
    int value;
};
struct Double {
    double value;
};
struct Boolean {
    bool value;
};
struct Null {};

using TokenId =
    std::variant<Workflow, Identifier, LeftBrace, Equal, Semicolon, RightBrace,
                 LeftParen, RightParen, LeftBracket, RightBracket, Switch, Case,
                 Default, Loop, While, String, Integer, Double, Boolean, Null>;

struct Token {
    TokenId id;
    int line;
    int col;
};

std::vector<Token> lex(std::string_view s);

} // namespace complier::lex
