# complier — portable C++ state machine
#
# Targets:
#   make            build static lib + test runner
#   make test       build and run tests
#   make debug      debug build (asserts, sanitizers, -O0 -g)
#   make clean      remove build artifacts
#
# Layout:
#   include/complier/   public headers (.hpp)
#   src/                implementation (.cpp)
#   tests/              test sources, one binary
#   build/              all artifacts (git-ignored)

CXX      ?= c++
CXXSTD   := -std=c++20
WARN     := -Wall -Wextra -Wpedantic -Wshadow -Wconversion
INCLUDES := -Iinclude

BUILD    ?= release
ifeq ($(BUILD),debug)
  BUILDFLAGS := -O0 -g -fsanitize=address,undefined -fno-omit-frame-pointer
else
  BUILDFLAGS := -O2 -DNDEBUG
endif

CXXFLAGS := $(CXXSTD) $(WARN) $(INCLUDES) $(BUILDFLAGS) -MMD -MP
LDFLAGS  := $(BUILDFLAGS)

BUILDDIR := build/$(BUILD)
LIB      := $(BUILDDIR)/libcomplier.a
TESTBIN  := $(BUILDDIR)/complier_tests

SRCS      := $(wildcard src/*.cpp)
OBJS      := $(patsubst src/%.cpp,$(BUILDDIR)/obj/%.o,$(SRCS))
TEST_SRCS := $(wildcard tests/*.cpp)
TEST_OBJS := $(patsubst tests/%.cpp,$(BUILDDIR)/obj/tests/%.o,$(TEST_SRCS))
DEPS      := $(OBJS:.o=.d) $(TEST_OBJS:.o=.d)

.PHONY: all test debug clean

all: $(LIB) $(TESTBIN)

test: $(TESTBIN)
	./$(TESTBIN)

debug:
	$(MAKE) BUILD=debug test

$(LIB): $(OBJS)
	@mkdir -p $(dir $@)
	ar rcs $@ $^

$(TESTBIN): $(TEST_OBJS) $(LIB)
	$(CXX) $(LDFLAGS) -o $@ $(TEST_OBJS) $(LIB)

$(BUILDDIR)/obj/%.o: src/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -c -o $@ $<

$(BUILDDIR)/obj/tests/%.o: tests/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -c -o $@ $<

clean:
	rm -rf build

-include $(DEPS)
