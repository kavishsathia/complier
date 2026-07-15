#pragma once

#include <string_view>

#include "complier/ast.hpp"

namespace complier {

ast::Program parse(std::string_view source);

}  // namespace complier
