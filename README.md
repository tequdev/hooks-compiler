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

The toolchain is clang 22 from `@live-codes/clang-wasm` (pinned to an exact version), which wraps the clang/lld wasm builds from `@wasm-idle/llvm-core`.

- Node: nothing to do, the ~28 MB of assets ship in the package.
- Browser: copy the assets somewhere your app serves, then pass that URL as `baseUrl`:

```sh
npx hooks-compiler-copy-assets public/clang
```

## Usage

Library:

```ts
import { compile } from "hooks-compiler";

const r = await compile({ files: { "hook.c": source, "hookapi.h": header } }); // entry defaults to "hook.c"
r.wasm; r.sha256; r.imports; r.exports; r.wat; r.logs;
```

Options: `entry`, `opt` (clang level, `-O0` to `-Oz`, default `-O2`), `baseUrl` (toolchain assets, required in browsers), `onProgress(fraction)` (0..1; see `ProgressFn` for the 0.3.0 caveat) for the toolchain download. `check(files, entry?, { baseUrl, onProgress })` runs `clang -fsyntax-only` and returns diagnostic lines. `prefetchToolchain({ baseUrl, onProgress })` downloads the toolchain ahead of the first compile.

Worker:

```ts
const worker = new Worker(new URL("hooks-compiler/worker", import.meta.url), { type: "module" });
worker.postMessage({ id: 1, type: "compile", files: { "hook.c": source }, opt: "-Oz", baseUrl: new URL("/clang/", location.href).href }); // or type: "check"
// replies: { id, progress: number } ..., then { id, result } | { id, lines } | { id, error }
```

`WorkerRequest` and `WorkerResponse` types are exported from `hooks-compiler/worker`. Until `@live-codes/clang-wasm` fixes its progress callback (registered after the load), only `progress: 1` arrives; show an indeterminate state.

Standalone worker (no bundler configuration): the package ships `dist-worker/` (worker.js, binaryen.js, hook-cleaner.wasm; built by `pnpm build:worker`). Copy it to a static directory, put the toolchain assets in `clang/` beside it, and the worker uses that directory when no `baseUrl` is sent:

```sh
cp -r node_modules/hooks-compiler/dist-worker public/compiler
npx hooks-compiler-copy-assets public/compiler/clang
```

```ts
const worker = new Worker("/compiler/worker.js", { type: "module" });
```

webpack: `binaryen` has a top-level await, so enable it; nothing else is needed.

```js
config.experiments = { ...config.experiments, topLevelAwait: true };
```

Vite: keep this package out of dependency pre-bundling (it rewrites `import.meta.url`, so the cleaner wasm 404s in dev) and allow top-level await:

```ts
optimizeDeps: { exclude: ["hooks-compiler"], esbuildOptions: { target: "esnext" } }
```

CLI:

```sh
hooks-compiler hook.c hookapi.h -o hook.wasm -Oz   # logs on stderr, "<out> <bytes> bytes sha256 <hash>" on stdout
```

## Exact arguments

clang runs its driver in-process and only with `-c`; wasm-ld is invoked separately.

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
pnpm install        # also builds src/hook-cleaner.wasm from tools/hook-cleaner and copies the toolchain assets to public/clang (prepare)
pnpm dev            # demo page: compiles 3 times and compares hashes
pnpm build          # tsc → dist/ (+ hook-cleaner.wasm)
pnpm build:worker   # standalone worker bundle → dist-worker/
pnpm test
```

`tools/VENDOR.md` documents the vendored hook-cleaner source.
