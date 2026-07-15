#pragma once

#include <string_view>

#include "complier/ast.hpp"
#include "complier/contract.hpp"

namespace complier {

Contract compile(const ast::Program& program, std::string_view source);

}  // namespace complier
