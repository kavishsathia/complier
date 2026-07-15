# csm — complier state machine

Rewrite of the complier state machine as a portable C++20 static library.

## Layout

```
include/complier/   public headers (.hpp) — the API surface
src/                implementation (.cpp), one per header as they land
tests/              dependency-free test harness (tests/testing.hpp) + test files
build/              all artifacts, git-ignored
```

## Build

```bash
make            # release build: build/release/libcomplier.a + test binary
make test       # build and run tests
make debug      # -O0 -g with ASan/UBSan, then run tests
make clean
```

No dependencies beyond a C++20 compiler and make. New `.cpp` files under
`src/` and `tests/` are picked up automatically by the Makefile wildcards.

## Adding a test

```cpp
#include "testing.hpp"

TEST(my_test_name) {
    CHECK(condition);
    CHECK_EQ(actual, expected);
}
```

Drop the file in `tests/`; it self-registers and runs via `make test`.
