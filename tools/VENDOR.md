# Vendored post-processing tool

`hook-cleaner` is compiled to a WASI reactor module by
`scripts/build-cleaner.ts` (run by `pnpm install` via `prepare`) using the same
`@live-codes/clang-wasm` toolchain that compiles hooks. It is linked as a reactor
with an inline `_initialize` stub, because the shipped sysroot lacks `crt1-reactor.o`. The output, `src/hook-cleaner.wasm`,
is gitignored. The source is the unmodified upstream file.

| Path | Upstream | License |
|---|---|---|
| `hook-cleaner/cleaner.c` | github.com/tequdev/hook-cleaner (fork of RichardAH/hook-cleaner), v1.1 source, commit a622d8f | upstream ships no license file |

Exports used by `src/index.ts`:

- hook-cleaner: `cleaner(inp, out, &len) -> int`, `malloc`. `len` is in/out (`ssize_t`, 32-bit); `out` must hold `2 * len` bytes.
