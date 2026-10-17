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

The toolchain is clang 22 from `@live-codes/clang-wasm` (pinned to an exact version), which wraps the clang/lld wasm builds from `@wasm-idle/llvm-core`. Node >= 20.12 is required. Node needs nothing else (the ~28 MB of assets ship in the dependency). Browsers need the assets served, see [Browser setup](#browser-setup).

## Quick start

Node:

```ts
import { createCompiler } from "hooks-compiler";

const compiler = createCompiler();
const r = await compiler.compile({ files: { "hook.c": source, "hookapi.h": header } }); // entry defaults to "hook.c"
r.wasm; r.sha256; r.imports; r.exports; r.logs;
```

Browser (runs in a Web Worker):

```ts
import { createCompiler } from "hooks-compiler";

const compiler = createCompiler({ baseUrl: "/compiler/clang/", onProgress: (f) => console.log(f) });
const r = await compiler.compile({ files: { "hook.c": source }, opt: "-Oz", wat: true });
const lines = await compiler.check({ files: { "hook.c": source } }); // clang -fsyntax-only diagnostics
await compiler.prefetch(); // download the toolchain ahead of the first compile
compiler.terminate();
```

`compile` options: `files`, `entry`, `opt` (`-O0` to `-Oz`, default `-O2`), `wat` (also return the final module as WAT, default false). The Node `createCompiler` runs inline in the current process, `terminate()` is a no-op.

## CLI

```sh
hooks-compiler build hook.c -I include -o hook.wasm -Oz [--wat] [--json]
hooks-compiler check hook.c -I include
hooks-compiler copy-assets [directory]   # default ./compiler
```

- Positional files are keyed by basename; the first is the entry. The first source for a name wins: positional files, then `-I` dirs in command-line order (as with clang's include search).
- `-I <dir>` (repeatable) adds every file under `dir`, keyed by its path relative to `dir`, so `-I include` makes `include/sub/x.h` reachable as `#include "sub/x.h"`.
- `build` logs to stderr and writes `-o` (default `<entry>.wasm`). `--wat` also writes `<out>.wat`. `--json` prints `{ output, sha256, rawSize, optimizedSize, finalSize, imports, exports, wat? }` to stdout instead of `<out> <bytes> bytes sha256 <hash>`.
- `check` prints diagnostics to stdout and exits 1 if any line contains `error:`.

## Browser setup

```sh
npx hooks-compiler copy-assets public/compiler
```

This creates `public/compiler/` with `worker.js`, `browser.js`, `hook-cleaner.wasm`, `binaryen.js` and `clang/` (the toolchain). Then either:

a. With a bundler, keep the bundled worker and point it at the toolchain:

```ts
const compiler = createCompiler({ baseUrl: "/compiler/clang/" });
```

A relative `baseUrl` is resolved against the page, not the worker script.

b. Without a bundler, use the standalone worker (its `baseUrl` defaults to `./clang/` beside itself):

```ts
const compiler = createCompiler({ worker: new Worker("/compiler/worker.js", { type: "module" }) });
```

webpack: `binaryen` has a top-level await, so enable it; nothing else is needed.

```js
config.experiments = { ...config.experiments, topLevelAwait: true };
```

Vite: keep this package out of dependency pre-bundling (it rewrites `import.meta.url`, so the cleaner wasm 404s in dev) and allow top-level await:

```ts
optimizeDeps: { exclude: ["hooks-compiler"], esbuildOptions: { target: "esnext" } }
```

The package's own `new Worker(new URL("./worker.js", import.meta.url))` is the bundler-standard pattern, but it has not been verified under Vite's dependency optimizer. If it misbehaves, pass your own `worker` (option b).

## Low-level API

```ts
import { compile, check, prefetchToolchain, VERSIONS } from "hooks-compiler";

await compile({ files, entry, opt, wat, baseUrl, onProgress });
await check({ files, entry, baseUrl, onProgress });
await prefetchToolchain({ baseUrl, onProgress });
```

These run on the calling thread (`hooks-compiler` resolves to the Node build under Node, the browser build elsewhere). `baseUrl` is required in browsers. `onProgress(fraction)` is 0..1; until `@live-codes/clang-wasm` fixes its progress callback (registered after the load), only `1` arrives, so show an indeterminate state.

`VERSIONS` is `{ clangWasm, binaryen }`, the pinned dependency versions this release is built on (clang 22 comes from `@live-codes/clang-wasm`).

Worker protocol (`hooks-compiler/worker`, also the standalone `worker.js`): post a `WorkerRequest` with a unique `id`, receive `WorkerResponse` messages with the same `id`.

```ts
type WorkerRequest =
  | { id; type: "compile"; files; entry?; opt?; wat?; baseUrl? }
  | { id; type: "check"; files; entry?; baseUrl? }
  | { id; type: "prefetch"; baseUrl? };
type WorkerResponse = { id; progress } | { id; result } | { id; lines } | { id; ok: true } | { id; error };
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

The same sources produce byte-identical output. `pnpm test` compiles `examples/hello.c` three times and compares the SHA-256; the CLI and `createCompiler` are checked against the same hash, and `pnpm test:e2e` checks that the browser demo produces the Node hash.

## Guard check

Not part of the pipeline. Validate the output with the xahaud `hook_validate` RPC (Xahau/xahaud PR #882).

## Development

```sh
pnpm install     # also builds src/hook-cleaner.wasm from tools/hook-cleaner (prepare)
pnpm dev         # demo page: compiles 3 times and compares hashes (serves the toolchain from node_modules)
pnpm build       # tsc → dist/, standalone worker bundle → dist/standalone/
pnpm lint        # biome check (pnpm format to fix formatting)
pnpm test        # unit tests, including the CLI
pnpm test:e2e    # Playwright against the demo (needs: pnpm exec playwright install chromium)
```

`tools/VENDOR.md` documents the vendored hook-cleaner source.
