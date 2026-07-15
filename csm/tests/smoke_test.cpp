#include "complier/complier.hpp"
#include "complier/lexer.hpp"
#include "testing.hpp"
#include <iostream>

#include <string>

TEST(version_is_reported) {
    CHECK_EQ(std::string(complier::version()), "0.1.0");
}

TEST(lexing_works) {
    std::string s = "say \"hi\"";
    std::cout << complier::lex::lex(s).size();
}
