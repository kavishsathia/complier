#pragma once

#include <map>
#include <string>
#include <string_view>

#include "complier/ast.hpp"
#include "complier/runtime.hpp"

namespace complier {

struct Contract {
    std::string name;
    std::map<std::string, rt::CompiledWorkflow> workflows;
    std::map<std::string, ast::Constraint> guarantees;
    std::string source;

    // parse, compile and validate an authored contract
    static Contract from_source(std::string_view source);
};

}  // namespace complier
