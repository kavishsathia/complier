#include "complier/lexer.hpp"
#include <cctype>
#include <format>
#include <stdexcept>

static void lex_string(std::string_view source,
                       std::vector<complier::lex::Token> &tokens, int &i,
                       int &line_no, int &col_no);
static void lex_term(std::string_view source,
                     std::vector<complier::lex::Token> &tokens, int &i,
                     int &line_no, int &col_no);

std::vector<complier::lex::Token> complier::lex::lex(std::string_view source) {
    std::vector<complier::lex::Token> tokens;

    int i = 0;
    int line_no = 0;
    int col_no = 0;

    while (i < source.size()) {
        char c = source[i];

        if (c == ' ' || c == '\t') {
            i++;
            col_no++;
        } else if (c == '\n') {
            i++;
            line_no++;
            col_no = 0;
        } else if (c == '"') {
            lex_string(source, tokens, i, line_no, col_no);
        } else if (isdigit(c)) {
            i++;
            throw std::logic_error("unimplemented: lex_number");
        } else if (isalpha(c)) {
            lex_term(source, tokens, i, line_no, col_no);
        } else {
            i++;
            col_no++;
            if (c == '{') {
                tokens.push_back({LeftBrace{}, line_no, col_no});
            } else if (c == '}') {
                tokens.push_back({RightBrace{}, line_no, col_no});
            } else if (c == '[') {
                tokens.push_back({LeftBracket{}, line_no, col_no});
            } else if (c == ']') {
                tokens.push_back({RightBracket{}, line_no, col_no});
            } else if (c == '(') {
                tokens.push_back({LeftParen{}, line_no, col_no});
            } else if (c == ')') {
                tokens.push_back({RightParen{}, line_no, col_no});
            } else if (c == ';') {
                tokens.push_back({Semicolon{}, line_no, col_no});
            } else if (c == '=') {
                tokens.push_back({Equal{}, line_no, col_no});
            } else {
                throw std::logic_error(
                    std::format("Syntax error at or near line {} column {}",
                                line_no, col_no));
            }
        }
    }

    return tokens;
}

static void lex_string(std::string_view source,
                       std::vector<complier::lex::Token> &tokens, int &i,
                       int &line_no, int &col_no) {
    int start = ++i;

    while (i < source.size() && source[i] != '"') {
        if (source[i] == '\n') {
            line_no++;
            col_no = 0;
        }

        if (source[i] == '\\' && i + 1 < source.size() && source[i] == '"') {
            col_no++;
            i++;
        }

        col_no++;
        i++;
    }

    if (i == source.size()) {
        throw std::logic_error("string not closed");
    }

    tokens.push_back({complier::lex::String{source.substr(start, i++ - start)},
                      line_no, col_no});
}

static void lex_term(std::string_view source,
                     std::vector<complier::lex::Token> &tokens, int &i,
                     int &line_no, int &col_no) {
    int start = i;

    while (i < source.size() && (isalnum(source[i]) || source[i] == '_')) {
        col_no++;
        i++;
    }

    std::string_view identifier = source.substr(start, i - start);

    if (identifier == "loop")
        tokens.push_back({complier::lex::Loop{}, line_no, col_no});
    else if (identifier == "while")
        tokens.push_back({complier::lex::While{}, line_no, col_no});
    else if (identifier == "switch")
        tokens.push_back({complier::lex::Switch{}, line_no, col_no});
    else if (identifier == "case")
        tokens.push_back({complier::lex::Case{}, line_no, col_no});
    else if (identifier == "default")
        tokens.push_back({complier::lex::Default{}, line_no, col_no});
    else if (identifier == "workflow")
        tokens.push_back({complier::lex::Workflow{}, line_no, col_no});
    else
        tokens.push_back(
            {complier::lex::Identifier{identifier}, line_no, col_no});
}