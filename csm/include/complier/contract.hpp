#pragma once

#include <map>
#include <string>

#include "complier/ast.hpp"
#include "complier/runtime.hpp"

namespace complier {

struct Contract {
    std::string name;
    std::map<std::string, rt::CompiledWorkflow> workflows;
    std::map<std::string, ast::Constraint> guarantees;
    std::string source;
};

}  // namespace complier
