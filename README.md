# hooks-compiler

Proof of concept: a Xahau C Hook compiled **entirely inside the browser**, with no compiler server.

```text
C source → clang.wasm → hook.o → wasm-ld.wasm → hook.raw.wasm → xahau-hook-wasm.wasm → hook.wasm
```

## What it proves

- Clang and LLD compiled to WebAssembly (`@yowasp/clang`) can compile and link a freestanding Xahau Hook in a Web Worker.
- A Rust crate compiled to `wasm32-unknown-unknown` can post-process the linked module in the same worker.
- The output is deterministic: the same source compiled 3 times in one session yields a byte-identical module (checked in the UI and by `pnpm test:determinism`).
- The only network traffic is static files from the dev server (toolchain wasm, resources tar, the Rust wasm). No request carries source code.

## Architecture

```text
index.html / src/main.ts      UI: textarea, Compile (runs 3 builds), sizes, SHA-256, imports/exports, WAT, download; styled with @digital-go-jp/design-tokens (Digital Agency Design System)
src/compiler-worker.ts        Web Worker; owns the toolchain and the Rust wasm
src/compiler.ts               the pipeline (shared by the worker and the Node script)
hookapi/hookapi.h             minimal Hook API subset, declarations copied from xahaud hook/extern.h + macro.h
examples/hello.c              the bundled example (hook, _g, accept)
crates/xahau-hook-wasm        Rust post-processor (wasmparser + wasm-encoder) → public/xahau-hook-wasm.wasm
scripts/determinism.ts        same pipeline in Node, 3 builds, exits non-zero if hashes differ
```

Virtual filesystem layout inside the toolchain: `/src/hook.c`, `/include/hookapi.h`, `/build/hook.o`, `/build/hook.raw.wasm`.

The Rust crate currently does: validate the module, require a `hook` function export, drop every custom section (`name`, `producers`, `target_features`), re-encode. It also prints the final module as WAT via `wasmprinter`. It exposes a raw C ABI (`alloc_bytes`, `process_raw`, `info_raw`, `wat_raw`, `result_ptr/len`) so no wasm-bindgen toolchain is needed.

## Setup

Requirements: Node 22+, pnpm (`mise.toml` pins it), Rust with the `wasm32-unknown-unknown` target.

```sh
rustup target add wasm32-unknown-unknown
pnpm install                 # npm install also works
pnpm build:wasm              # builds the Rust crate and copies it to public/xahau-hook-wasm.wasm
pnpm dev                     # open http://localhost:5173 and press Compile
pnpm test:determinism        # Node: 3 builds, prints hashes and "Deterministic: YES"
```

`cargo test --manifest-path crates/xahau-hook-wasm/Cargo.toml` runs the crate's unit test.

The first Compile fetches ~100 MB of toolchain wasm from the dev server; later builds take well under a second.

## Exact toolchain arguments

```sh
clang -target wasm32 -O2 -nostdlib -nostartfiles -Werror=implicit-function-declaration \
      -I/include -c /src/hook.c -o /build/hook.o
wasm-ld --no-entry --allow-undefined --export=hook /build/hook.o -o /build/hook.raw.wasm
```

Compared with the legacy Xahau compiler service (`--no-standard-libraries -nostartfiles -Wl,--allow-undefined,--no-entry,--export-all`), `--export-all` is replaced by `--export=hook`; everything else that the clang driver would add for a hosted target is not needed because the module is freestanding.

Result for `examples/hello.c`:

| | |
|---|---|
| imports | `env._g`, `env.accept` |
| exports | `memory`, `hook` |
| raw / final size | 521 / 161 bytes |
| `_start` / WASI `main` | none |

## Current limitations

- **This PoC does not guarantee the module passes Xahau `SetHook` validation.** The post-processor only strips custom sections. Not yet done: the `hook-cleaner` pass (export restriction, GC of unreachable functions, data trimming), `wasm-opt`, and the `guard_checker` / worst-case-instruction checks. The next step is to port the pure-Rust `clean`, `flatten`, `unnest` and `validate` passes from `rshooks-build` into `crates/xahau-hook-wasm` (its native guard checker wraps C++ and cannot target wasm as is).
- `@yowasp/clang` is pinned to `21.1.4-3`, the newest release with npm provenance; `22.0.0-git*` builds are unsigned and rejected by the local supply-chain policy.
- `cbak` is not exported (`--export=hook` only). Add `--export=cbak` when an example defines it.
- The ~70 MB `llvm.core.wasm` is served uncompressed by the dev server. A production deployment should serve it with Brotli/gzip.
- Single file, single header, no diagnostics parsing; compiler errors are shown as raw log text.
