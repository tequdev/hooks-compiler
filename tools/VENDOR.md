# Vendored post-processing tools

Both tools are compiled to `wasm32-wasip1` reactor modules by
`scripts/build-tools.ts` using the same `@yowasp/clang` toolchain that compiles
hooks in the browser. Sources are unmodified upstream files.

| Path | Upstream | License |
|---|---|---|
| `hook-cleaner/cleaner.c` | github.com/tequdev/hook-cleaner (fork of RichardAH/hook-cleaner), v1.1 source, commit a622d8f | upstream ships no license file |
| `guard-checker/Guard.h`, `Enum.h`, `hook_api.macro` | Xahau/xahaud `release` branch, `include/xrpl/hook/`, hashes in `SHA256SUMS` | ISC |
| `guard-checker/guard_shim.cpp` | github.com/tequdev/rshooks `crates/rshooks-build/cpp/` | MIT |
| `guard-checker/eh_stub.cpp` | this repository | MIT |

Exports used by `src/compiler.ts`:

- hook-cleaner: `cleaner(inp, out, &len) -> int`, `malloc`, `free`. `len` is in/out (`ssize_t`, 32-bit); `out` must hold `2 * len` bytes.
- guard-checker: `rshooks_validate_guards(wasm, len, &hook_cost: u64, &cbak_cost: u64, log_buf, log_cap, &log_len) -> 0 valid | 1 invalid | 2 threw`, `malloc`, `free`.
