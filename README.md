# hooks-compiler

Deterministic Xahau C Hook compiler. Clang, lld, wasm-opt and hook-cleaner all run as WebAssembly, in the browser (Web Worker) or in Node. No compiler server.

```text
C source → clang.wasm → hook.o → wasm-ld.wasm → hook.raw.wasm
       → wasm-opt -Oz (binaryen.js, MVP only) → hook-cleaner.wasm → hook.wasm
```

## Install

```sh
pnpm add hooks-compiler
```

The first compile downloads the ~100 MB `@yowasp/clang` toolchain (cached afterwards). `@yowasp/clang` is pinned to `21.1.4-3`, the newest release with npm provenance.

## Usage

Library:

```ts
import { compile } from "hooks-compiler";

const r = await compile({ files: { "hook.c": source, "hookapi.h": header } }); // entry defaults to "hook.c"
r.wasm; r.sha256; r.imports; r.exports; r.wat; r.logs;
```

Options: `entry`, `opt` (clang level, `-O0` to `-Oz`, default `-O2`), `onProgress(done, total)` for the toolchain download. `check(files, entry?)` runs `clang -fsyntax-only` and returns diagnostic lines. `prefetchToolchain(onProgress?)` downloads the toolchain ahead of the first compile.

Worker:

```ts
const worker = new Worker(new URL("hooks-compiler/worker", import.meta.url), { type: "module" });
worker.postMessage({ id: 1, type: "compile", files: { "hook.c": source }, opt: "-Oz" }); // or type: "check"
// replies: { id, progress: { done, total } } ..., then { id, result } | { id, lines } | { id, error }
```

`WorkerRequest` and `WorkerResponse` types are exported from `hooks-compiler/worker`. `pnpm build:worker` also produces a standalone bundle in `dist-worker/`.

Vite: keep the wasm-loading packages out of dependency pre-bundling (it rewrites `import.meta.url`, so the wasm files 404 in dev) and allow top-level await:

```ts
optimizeDeps: { exclude: ["@yowasp/clang", "hooks-compiler"], esbuildOptions: { target: "esnext" } }
```

CLI:

```sh
hooks-compiler hook.c hookapi.h -o hook.wasm -Oz   # logs on stderr, "<out> <bytes> bytes sha256 <hash>" on stdout
```

## Exact arguments

```sh
clang -target wasm32 -mcpu=mvp -O2 -nostdlib -nostartfiles -Werror=implicit-function-declaration \
      -Wno-error=int-conversion -w -I/src -c /src/hook.c -o /build/hook.o
wasm-ld --no-entry --allow-undefined --export=hook --export-if-defined=cbak /build/hook.o -o /build/hook.raw.wasm
```

`-Wno-error=int-conversion` keeps clang 16+ from rejecting the common Hook idiom of passing a `uint8_t*` to a `uint32_t` API parameter (older clang only warned); `-w` then silences all warnings. `-Werror=implicit-function-declaration` still applies (`-w` does not override it).

wasm-opt (binaryen.js): read the module, `setFeatures(Features.MVP)`, validate, `setOptimizeLevel(2)`, `setShrinkLevel(2)` (`-Oz`), `optimize()`, `emitBinary()`.

wasm-opt runs before hook-cleaner because the cleaner strips the `memory` export, and a later wasm-opt would then dead-code-eliminate the memory and data segment. The module is restricted to the WebAssembly MVP because binaryen otherwise ORs in any `target_features` section and may emit post-MVP opcodes; compiling with `-mcpu=mvp` and validating under MVP rejects those up front.

## Determinism

The same sources produce byte-identical output. `pnpm test` compiles `examples/hello.c` three times and compares the SHA-256.

## Guard check

Not part of the pipeline. Validate the output with the xahaud `hook_validate` RPC (Xahau/xahaud PR #882).

## Development

```sh
pnpm install        # also builds src/hook-cleaner.wasm from tools/hook-cleaner (prepare)
pnpm dev            # demo page: compiles 3 times and compares hashes
pnpm build          # tsc → dist/ (+ hook-cleaner.wasm)
pnpm build:worker   # standalone worker bundle → dist-worker/
pnpm test
```

`tools/VENDOR.md` documents the vendored hook-cleaner source.
