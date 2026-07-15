#pragma once

// Minimal dependency-free test harness.
//
//   TEST(parser_handles_empty_input) {
//       CHECK(1 + 1 == 2);
//       CHECK_EQ(parse(""), Program{});
//   }
//
// Each TEST self-registers; tests/main.cpp runs them all.

#include <functional>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace complier::testing {

struct Test {
    std::string name;
    std::function<void()> fn;
};

inline std::vector<Test>& registry() {
    static std::vector<Test> tests;
    return tests;
}

inline int& failure_count() {
    static int failures = 0;
    return failures;
}

struct Registrar {
    Registrar(std::string name, std::function<void()> fn) {
        registry().push_back({std::move(name), std::move(fn)});
    }
};

inline void report_failure(const char* file, int line, const std::string& what) {
    ++failure_count();
    std::cerr << file << ":" << line << ": FAILED: " << what << "\n";
}

inline int run_all() {
    for (const auto& test : registry()) {
        int before = failure_count();
        test.fn();
        std::cerr << (failure_count() == before ? "  ok  " : " FAIL ") << test.name << "\n";
    }
    std::cerr << registry().size() << " tests, " << failure_count() << " failures\n";
    return failure_count() == 0 ? 0 : 1;
}

}  // namespace complier::testing

#define TEST(name)                                                            \
    static void test_##name();                                                \
    static ::complier::testing::Registrar registrar_##name{#name, test_##name}; \
    static void test_##name()

#define CHECK(expr)                                                           \
    do {                                                                      \
        if (!(expr)) ::complier::testing::report_failure(__FILE__, __LINE__, #expr); \
    } while (0)

#define CHECK_EQ(a, b)                                                        \
    do {                                                                      \
        if (!((a) == (b))) {                                                  \
            std::ostringstream oss_;                                          \
            oss_ << #a " == " #b;                                             \
            ::complier::testing::report_failure(__FILE__, __LINE__, oss_.str()); \
        }                                                                     \
    } while (0)
