#include "complier/complier.hpp"
#include "testing.hpp"

#include <string>

TEST(version_is_reported) {
    CHECK_EQ(std::string(complier::version()), "0.1.0");
}
