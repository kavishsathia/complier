#pragma once

#include <stdexcept>
#include <string>

namespace complier {

class ParseError : public std::runtime_error {
public:
    ParseError(const std::string& what, int at_line, int at_col)
        : std::runtime_error(what + " (line " + std::to_string(at_line) + ", column " +
                             std::to_string(at_col) + ")"),
          line(at_line),
          col(at_col) {}

    int line;
    int col;
};

class CompileError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

}  // namespace complier
