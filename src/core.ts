import { compilerDiagnostics, createToolchain, type Toolchain } from "@live-codes/clang-wasm/toolchain";
import { instantiateReactor } from "./wasi.ts";

export type OptLevel = "-O0" | "-O1" | "-O2" | "-O3" | "-Os" | "-Oz";

// 0..1. @live-codes/clang-wasm 0.3.0 registers its progress callback only after the load, so until
// that is fixed upstream only the final 1 (emitted here) arrives; treat the download as indeterminate.
export type ProgressFn = (fraction: number) => void;

export type ToolchainOptions = {
  baseUrl?: string | URL; // directory holding the assets from `clang-wasm-copy-assets`; required in browsers, Node reads node_modules
  onProgress?: ProgressFn; // toolchain download progress
};

export type CompileInput = {
  files: Record<string, string>; // every .c/.h, placed under /src; headers resolve via -I/src
  entry?: string; // the .c file to compile, default "hook.c"
  opt?: OptLevel; // clang optimization level, default -O2
  wat?: boolean; // also emit the final module as WAT, default false
} & ToolchainOptions;

export const VERSIONS = { clangWasm: "0.3.0", clang: "22.1.8", binaryen: "132.0.0" } as const;

/** What `createCompiler` returns: the same pipeline behind promises, optionally in a worker. */
export type Compiler = {
  compile(input: Omit<CompileInput, keyof ToolchainOptions>): Promise<CompileResult>;
  check(files: Record<string, string>, entry?: string): Promise<string[]>;
  prefetch(): Promise<void>;
  terminate(): void;
};

export type CompileResult = {
  wasm: Uint8Array;
  rawSize: number;
  optimizedSize: number;
  finalSize: number;
  sha256: string;
  imports: string[]; // "env._g"
  exports: string[];
  wat?: string; // only when requested
  logs: string[];
};

// Final flags; documented in README.
const CLANG_FLAGS = [
  "-target",
  "wasm32",
  "-mcpu=mvp",
  "-nostdlib",
  "-nostartfiles",
  "-Werror=implicit-function-declaration",
  "-Wno-error=int-conversion", // existing hooks pass uint8_t* to uint32_t API params; clang 16+ made that an error
  "-w", // and no warnings at all; -Werror= above still applies
  "-I/src",
];
const LLD_ARGS = [
  "--no-entry",
  "--allow-undefined",
  "--export=hook",
  "--export-if-defined=cbak",
  "/build/hook.o",
  "-o",
  "/build/hook.raw.wasm",
];

class ToolExit extends Error {}

type Tools = { tc: Toolchain; clang: WebAssembly.Module; lld: WebAssembly.Module };
const toolchains = new Map<string, Promise<Tools>>();

function getToolchain({ baseUrl, onProgress }: ToolchainOptions = {}): Promise<Tools> {
  const key = String(baseUrl ?? "");
  let p = toolchains.get(key);
  if (!p) {
    p = (async () => {
      const tc = await createToolchain({ baseUrl, onProgress });
      const { runtime } = tc;
      const [clang, lld] = await Promise.all([runtime.getModule(runtime.assetUrls.clang), runtime.getModule(runtime.assetUrls.lld)]);
      runtime.memfs.addDirectory("build");
      onProgress?.(1);
      return { tc, clang, lld };
    })();
    toolchains.set(key, p);
    p.catch(() => toolchains.delete(key)); // allow a retry after a failed download
  }
  return p;
}

/** Runs one tool (must hold the toolchain lock), appending its diagnostic lines to `logs`; throws ToolExit on a non-zero exit. */
async function runTool(tc: Toolchain, mod: WebAssembly.Module, name: string, args: string[], logs: string[]): Promise<void> {
  logs.push(`$ ${name} ${args.join(" ")}`);
  const { raw, error } = await tc.captureCompilerOutput(() => tc.runtime.run(mod, true, name, ...args));
  const lines = compilerDiagnostics(raw).filter((l) => !/^Error: process exited with code \d+\.$/.test(l));
  logs.push(...lines);
  if (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code !== "number") throw error;
    throw new ToolExit(`${name} exited with code ${code}\n${logs.join("\n")}`);
  }
}

// ponytail: memfs has no delete, so files from earlier compiles stay visible in /src (a stale
// `#include "old.h"` could still resolve). Upgrade path: a fresh directory per compile.
// `path` is relative (`src/x.c`): tc.addFile breaks on a leading slash; clang still sees it as /src/x.c.
function put(tc: Toolchain, path: string, text: string) {
  if (tc.runtime.memfs.hasFile(path)) tc.runtime.memfs.setFile(path, new TextEncoder().encode(text));
  else tc.addFile(path, text);
}

type Binaryen = typeof import("binaryen").default;

// Imported lazily: binaryen.js has a top-level await, and Chromium drops messages posted to a
// module worker while its top-level evaluation is still pending.
let binaryenLoad: Promise<Binaryen> | undefined;
const loadBinaryen = () => (binaryenLoad ??= import("binaryen").then((m) => m.default));

/** Reads `bytes` restricted to the WebAssembly MVP feature set (ignoring any target_features section) and validates it. */
function withMvpModule<T>(binaryen: Binaryen, bytes: Uint8Array, invalid: string, fn: (m: ReturnType<Binaryen["readBinary"]>) => T): T {
  const m = binaryen.readBinary(bytes);
  try {
    m.setFeatures(binaryen.Features.MVP);
    if (!m.validate()) throw new Error(invalid);
    return fn(m);
  } finally {
    m.dispose();
  }
}

function runCleaner(mod: WebAssembly.Module, input: Uint8Array): Uint8Array {
  const r = instantiateReactor(mod);
  const ex = r.exports;
  const inp = ex.malloc(input.length) as number;
  const out = ex.malloc(input.length * 2) as number;
  const lenPtr = ex.malloc(4) as number;
  new Uint8Array(ex.memory.buffer).set(input, inp);
  new DataView(ex.memory.buffer).setInt32(lenPtr, input.length, true);
  const rc = ex.cleaner(inp, out, lenPtr) as number;
  if (rc !== 0) throw new Error(`hook-cleaner failed (code ${rc})\n${r.output()}`);
  const len = new DataView(ex.memory.buffer).getInt32(lenPtr, true);
  return new Uint8Array(ex.memory.buffer, out, len).slice();
}

function hex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Builds the pipeline; `readCleaner` supplies the bytes of hook-cleaner.wasm (compiled once, then cached). */
export function createApi(readCleaner: () => Promise<BufferSource>) {
  let cleaner: Promise<WebAssembly.Module> | undefined;
  const cleanerModule = () => (cleaner ??= readCleaner().then((bytes) => WebAssembly.compile(bytes)));

  /** Fetches the toolchain once, reporting progress. */
  async function prefetchToolchain(opts?: ToolchainOptions): Promise<void> {
    await getToolchain(opts);
  }

  /** Syntax-only pass for editor diagnostics. Returns clang's output lines (`/src/file:line:col: error: ...`). */
  async function check(files: Record<string, string>, entry = "hook.c", opts?: ToolchainOptions): Promise<string[]> {
    const { tc, clang } = await getToolchain(opts);
    return tc.lock(async () => {
      for (const [name, text] of Object.entries(files)) put(tc, `src/${name}`, text);
      const logs: string[] = [];
      try {
        await runTool(tc, clang, "clang", ["-fsyntax-only", ...CLANG_FLAGS, `/src/${entry}`], logs);
      } catch (e) {
        if (!(e instanceof ToolExit)) throw e; // a non-zero exit is the expected outcome for broken code
      }
      return logs.slice(1); // drop the "$ clang ..." line
    });
  }

  async function compile(input: CompileInput): Promise<CompileResult> {
    const logs: string[] = [];
    const entry = input.entry ?? "hook.c";
    const { tc, clang, lld } = await getToolchain(input);

    // The runtime is single-process and shared: hold the lock for every file write and tool run.
    const raw = await tc.lock(async () => {
      for (const [name, text] of Object.entries(input.files)) put(tc, `src/${name}`, text);
      await runTool(tc, clang, "clang", [...CLANG_FLAGS, input.opt ?? "-O2", "-c", `/src/${entry}`, "-o", "/build/hook.o"], logs);
      await runTool(tc, lld, "wasm-ld", LLD_ARGS, logs);
      return Uint8Array.from(tc.runtime.memfs.getFileContents("/build/hook.raw.wasm")); // a view into wasm memory: copy
    });
    logs.push(`hook.raw.wasm: ${raw.length} bytes`);

    // Before the cleaner: it strips the `memory` export, and wasm-opt's DCE would then drop the memory/data segment.
    logs.push("$ wasm-opt -Oz --mvp-features");
    const binaryen = await loadBinaryen();
    const optimized = withMvpModule(binaryen, raw, "hook.raw.wasm uses instructions outside the WebAssembly MVP (see console)", (m) => {
      binaryen.setOptimizeLevel(2);
      binaryen.setShrinkLevel(2);
      m.optimize();
      return m.emitBinary();
    });
    logs.push(`hook.opt.wasm: ${optimized.length} bytes`);

    logs.push("$ hook-cleaner");
    const wasm = runCleaner(await cleanerModule(), optimized);

    const wat = withMvpModule(binaryen, wasm, "hook.wasm is not a valid MVP module", (m) => (input.wat ? m.emitText() : undefined));
    const mod = new WebAssembly.Module(wasm as BufferSource);
    const imports = WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}`);
    const exports = WebAssembly.Module.exports(mod).map((e) => e.name);
    const sha256 = hex(await crypto.subtle.digest("SHA-256", wasm as BufferSource));
    logs.push(`hook.wasm: ${wasm.length} bytes, sha256 ${sha256}`);

    return { wasm, rawSize: raw.length, optimizedSize: optimized.length, finalSize: wasm.length, sha256, imports, exports, wat, logs };
  }

  return { compile, check, prefetchToolchain };
}
