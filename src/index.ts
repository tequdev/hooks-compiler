import { commands, Exit, type Tree } from "@yowasp/clang";
import { instantiateReactor } from "./wasi.ts";

export type OptLevel = "-O0" | "-O1" | "-O2" | "-O3" | "-Os" | "-Oz";

export type ProgressFn = (doneBytes: number, totalBytes: number) => void;

export type CompileInput = {
  files: Record<string, string>; // every .c/.h, placed under /src; headers resolve via -I/src
  entry?: string; // the .c file to compile, default "hook.c"
  opt?: OptLevel; // clang optimization level, default -O2
  onProgress?: ProgressFn; // toolchain download progress (first run fetches ~100 MB)
};

export type CompileResult = {
  wasm: Uint8Array;
  rawSize: number;
  optimizedSize: number;
  finalSize: number;
  sha256: string;
  imports: string[]; // "env._g"
  exports: string[];
  wat: string;
  logs: string[];
};

// Final flags; documented in README.
const CLANG_FLAGS = [
  "-target", "wasm32",
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
  "-o", "/build/hook.raw.wasm",
];

const dec = new TextDecoder();

class ToolExit extends Error {}

/** Collects a tool's stdout/stderr into `logs`, one entry per line. */
function toolRunner(logs: string[]) {
  let pending = "";
  const sink = (bytes: Uint8Array | null) => {
    if (!bytes) return;
    pending += dec.decode(bytes);
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    logs.push(...lines);
  };
  const opts = { stdout: sink, stderr: sink, decodeASCII: false as const };
  return async (name: "clang" | "wasm-ld", args: string[], files: Tree): Promise<Tree> => {
    logs.push(`$ ${name} ${args.join(" ")}`);
    try {
      return (await commands[name](args, files, opts)) as Tree;
    } catch (e) {
      if (e instanceof Exit) throw new ToolExit(`${name} exited with code ${e.code}\n${logs.join("\n")}`);
      throw e;
    }
  };
}

let prefetched: Promise<void> | undefined;

/**
 * Fetches the ~100 MB toolchain once, reporting progress. @yowasp/clang's clang
 * wrapper first runs an internal `-###` probe that drops `fetchProgress`, so a
 * plain `clang --version` is used to trigger the download with the callback.
 */
export function prefetchToolchain(onProgress?: ProgressFn): Promise<void> {
  prefetched ??= (async () => {
    try {
      await commands.clang(["--version"], {}, {
        stdout: null,
        stderr: null,
        fetchProgress: onProgress ? (e) => onProgress(e.doneLength, e.totalLength) : undefined,
      });
    } catch (e) {
      prefetched = undefined; // allow a retry after a failed download
      throw e;
    }
  })();
  return prefetched;
}

/** Syntax-only pass for editor diagnostics. Returns clang's output lines (`/src/file:line:col: error: ...`). */
export async function check(files: Record<string, string>, entry = "hook.c"): Promise<string[]> {
  const logs: string[] = [];
  const run = toolRunner(logs);
  try {
    await run("clang", ["-fsyntax-only", ...CLANG_FLAGS, `/src/${entry}`], { src: { ...files }, build: {} });
  } catch (e) {
    if (!(e instanceof ToolExit)) throw e; // diagnostics are in `logs`; a non-zero exit is the expected outcome for broken code
  }
  return logs.slice(1); // drop the "$ clang ..." line
}

export async function compile(input: CompileInput): Promise<CompileResult> {
  const logs: string[] = [];
  if (input.onProgress) await prefetchToolchain(input.onProgress);
  const run = toolRunner(logs);
  const entry = input.entry ?? "hook.c";

  // Fixed virtual paths: /src/<files>, /build/*
  const tree: Tree = { src: { ...input.files }, build: {} };
  const afterClang = await run("clang", [...CLANG_FLAGS, input.opt ?? "-O2", "-c", `/src/${entry}`, "-o", "/build/hook.o"], tree);
  const afterLld = await run("wasm-ld", LLD_ARGS, afterClang);
  const raw = (afterLld.build as Tree)["hook.raw.wasm"] as Uint8Array;
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

  const wat = withMvpModule(binaryen, wasm, "hook.wasm is not a valid MVP module", (m) => m.emitText());
  const mod = new WebAssembly.Module(wasm as BufferSource);
  const imports = WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}`);
  const exports = WebAssembly.Module.exports(mod).map((e) => e.name);
  const sha256 = hex(await crypto.subtle.digest("SHA-256", wasm as BufferSource));
  logs.push(`hook.wasm: ${wasm.length} bytes, sha256 ${sha256}`);

  return { wasm, rawSize: raw.length, optimizedSize: optimized.length, finalSize: wasm.length, sha256, imports, exports, wat, logs };
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

// Loaded once per process from the package itself (Vite stubs the node import in browser bundles).
let cleaner: Promise<WebAssembly.Module> | undefined;
function cleanerModule() {
  return (cleaner ??= (async () => {
    const url = new URL("./hook-cleaner.wasm", import.meta.url);
    const bytes = url.protocol === "file:" ? await (await import("node:fs/promises")).readFile(url) : await (await fetch(url)).arrayBuffer();
    return WebAssembly.compile(bytes as BufferSource);
  })());
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
