#include "complier/lexer.hpp"

#include <cctype>
#include <format>
#include <utility>

#include "complier/error.hpp"

namespace complier::lex {

namespace {

// tab width matches the indenter on the python side
constexpr int tab_width = 8;

bool is_ident_start(char c) {
    return std::isalpha(static_cast<unsigned char>(c)) || c == '_';
}

// identifiers may continue with . / - so tool names can look like paths
bool is_ident_char(char c) {
    return std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '.' || c == '/' ||
           c == '-';
}

struct Lexer {
    std::string_view src;
    std::size_t pos = 0;
    int line = 1;
    int col = 1;
    std::vector<int> indents = {0};
    std::vector<Token> tokens;

    bool eof() const { return pos >= src.size(); }
    char peek() const { return src[pos]; }

    char advance() {
        char c = src[pos++];
        if (c == '\n') {
            line++;
            col = 1;
        } else {
            col++;
        }
        return c;
    }

    void push(TokenKind kind, std::string text, int at_line, int at_col) {
        tokens.push_back({kind, std::move(text), at_line, at_col});
    }

    [[noreturn]] void fail(const std::string& msg) const { throw ParseError(msg, line, col); }

    std::vector<Token> run() {
        while (!eof()) {
            char c = peek();
            if (c == ' ' || c == '\t') {
                advance();
            } else if (c == '\n' || c == '\r') {
                newline_run();
            } else {
                token();
            }
        }
        if (!tokens.empty() && tokens.back().kind != TokenKind::Newline)
            push(TokenKind::Newline, "", line, col);
        while (indents.back() > 0) {
            indents.pop_back();
            push(TokenKind::Dedent, "", line, col);
        }
        push(TokenKind::Eof, "", line, col);
        return std::move(tokens);
    }

    // a run of newlines collapses to one Newline token; only the indent of
    // the last line matters, so blank lines never change nesting
    void newline_run() {
        int at_line = line;
        int at_col = col;
        int indent = 0;
        while (!eof() && (peek() == '\n' || peek() == '\r')) {
            if (peek() == '\r') advance();
            if (!eof() && peek() == '\n') advance();
            indent = 0;
            while (!eof() && (peek() == ' ' || peek() == '\t')) {
                indent += peek() == '\t' ? tab_width : 1;
                advance();
            }
        }
        push(TokenKind::Newline, "", at_line, at_col);
        if (eof()) return;

        if (indent > indents.back()) {
            indents.push_back(indent);
            push(TokenKind::Indent, "", line, col);
        } else {
            while (indent < indents.back()) {
                indents.pop_back();
                push(TokenKind::Dedent, "", line, col);
            }
            if (indent != indents.back()) fail("inconsistent indentation");
        }
    }

    void token() {
        int at_line = line;
        int at_col = col;
        char c = peek();

        switch (c) {
            case '"': string_token(at_line, at_col); return;
            case '(': delimited(')', TokenKind::HintPrompt, at_line, at_col); return;
            case '[': delimited(']', TokenKind::ModelPrompt, at_line, at_col); return;
            case '{': delimited('}', TokenKind::HumanPrompt, at_line, at_col); return;
            case '`': delimited('`', TokenKind::CelExpr, at_line, at_col); return;
            case '|': advance(); push(TokenKind::Pipe, "", at_line, at_col); return;
            case '=': advance(); push(TokenKind::Equals, "", at_line, at_col); return;
            case ':': advance(); push(TokenKind::Colon, "", at_line, at_col); return;
            case '@': directive(at_line, at_col); return;
            case '-': dash_keyword(at_line, at_col); return;
            default: break;
        }

        if (std::isdigit(static_cast<unsigned char>(c))) {
            number(at_line, at_col);
        } else if (is_ident_start(c)) {
            word(at_line, at_col);
        } else {
            fail(std::format("unexpected character '{}'", c));
        }
    }

    void string_token(int at_line, int at_col) {
        advance();
        std::string text;
        while (!eof() && peek() != '"') {
            if (peek() == '\n') fail("unterminated string");
            char c = advance();
            if (c != '\\') {
                text += c;
                continue;
            }
            if (eof()) fail("unterminated string");
            char esc = advance();
            switch (esc) {
                case 'n': text += '\n'; break;
                case 't': text += '\t'; break;
                case 'r': text += '\r'; break;
                case '"': text += '"'; break;
                case '\\': text += '\\'; break;
                default:
                    text += '\\';
                    text += esc;
                    break;
            }
        }
        if (eof()) fail("unterminated string");
        advance();
        push(TokenKind::Str, std::move(text), at_line, at_col);
    }

    void delimited(char close, TokenKind kind, int at_line, int at_col) {
        advance();
        std::string text;
        while (!eof() && peek() != close) text += advance();
        if (eof()) fail(std::format("missing closing '{}'", close));
        advance();
        push(kind, std::move(text), at_line, at_col);
    }

    void directive(int at_line, int at_col) {
        advance();
        std::string name;
        while (!eof() && is_ident_char(peek())) name += advance();

        TokenKind kind;
        if (name == "always") kind = TokenKind::AtAlways;
        else if (name == "ambient") kind = TokenKind::AtAmbient;
        else if (name == "llm") kind = TokenKind::AtLlm;
        else if (name == "human") kind = TokenKind::AtHuman;
        else if (name == "fork") kind = TokenKind::AtFork;
        else if (name == "join") kind = TokenKind::AtJoin;
        else if (name == "call") kind = TokenKind::AtCall;
        else if (name == "use") kind = TokenKind::AtUse;
        else if (name == "inline") kind = TokenKind::AtInline;
        else if (name == "branch") kind = TokenKind::AtBranch;
        else if (name == "loop") kind = TokenKind::AtLoop;
        else if (name == "unordered") kind = TokenKind::AtUnordered;
        else fail(std::format("unknown directive '@{}'", name));

        push(kind, "@" + name, at_line, at_col);
    }

    void dash_keyword(int at_line, int at_col) {
        advance();
        std::string name;
        while (!eof() && std::isalpha(static_cast<unsigned char>(peek()))) name += advance();

        TokenKind kind;
        if (name == "when") kind = TokenKind::When;
        else if (name == "else") kind = TokenKind::Else;
        else if (name == "until") kind = TokenKind::Until;
        else if (name == "step") kind = TokenKind::StepKw;
        else fail(std::format("unknown keyword '-{}'", name));

        push(kind, "-" + name, at_line, at_col);
    }

    void number(int at_line, int at_col) {
        std::string text;
        while (!eof() && std::isdigit(static_cast<unsigned char>(peek()))) text += advance();
        push(TokenKind::Number, std::move(text), at_line, at_col);
    }

    void word(int at_line, int at_col) {
        std::string text;
        while (!eof() && is_ident_char(peek())) text += advance();

        TokenKind kind = TokenKind::Ident;
        if (text == "guarantee") kind = TokenKind::Guarantee;
        else if (text == "workflow") kind = TokenKind::Workflow;
        else if (text == "halt") kind = TokenKind::Halt;
        else if (text == "skip") kind = TokenKind::Skip;
        else if (text == "true") kind = TokenKind::True;
        else if (text == "false") kind = TokenKind::False;
        else if (text == "null") kind = TokenKind::Null;

        push(kind, std::move(text), at_line, at_col);
    }
};

}  // namespace

const char* token_name(TokenKind kind) {
    switch (kind) {
        case TokenKind::Ident: return "identifier";
        case TokenKind::Number: return "number";
        case TokenKind::Str: return "string";
        case TokenKind::HintPrompt: return "(hint)";
        case TokenKind::ModelPrompt: return "[model prompt]";
        case TokenKind::HumanPrompt: return "{human prompt}";
        case TokenKind::CelExpr: return "`cel expression`";
        case TokenKind::Pipe: return "'|'";
        case TokenKind::Equals: return "'='";
        case TokenKind::Colon: return "':'";
        case TokenKind::Guarantee: return "'guarantee'";
        case TokenKind::Workflow: return "'workflow'";
        case TokenKind::AtAlways: return "'@always'";
        case TokenKind::AtAmbient: return "'@ambient'";
        case TokenKind::AtLlm: return "'@llm'";
        case TokenKind::AtHuman: return "'@human'";
        case TokenKind::AtFork: return "'@fork'";
        case TokenKind::AtJoin: return "'@join'";
        case TokenKind::AtCall: return "'@call'";
        case TokenKind::AtUse: return "'@use'";
        case TokenKind::AtInline: return "'@inline'";
        case TokenKind::AtBranch: return "'@branch'";
        case TokenKind::AtLoop: return "'@loop'";
        case TokenKind::AtUnordered: return "'@unordered'";
        case TokenKind::When: return "'-when'";
        case TokenKind::Else: return "'-else'";
        case TokenKind::Until: return "'-until'";
        case TokenKind::StepKw: return "'-step'";
        case TokenKind::Halt: return "'halt'";
        case TokenKind::Skip: return "'skip'";
        case TokenKind::True: return "'true'";
        case TokenKind::False: return "'false'";
        case TokenKind::Null: return "'null'";
        case TokenKind::Newline: return "newline";
        case TokenKind::Indent: return "indent";
        case TokenKind::Dedent: return "dedent";
        case TokenKind::Eof: return "end of input";
    }
    return "token";
}

std::vector<Token> lex(std::string_view source) {
    Lexer lexer;
    lexer.src = source;
    return lexer.run();
}

}  // namespace complier::lex
