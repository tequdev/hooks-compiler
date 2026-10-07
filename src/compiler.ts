import { commands, Exit, type Tree } from "@yowasp/clang";
import { instantiateReactor } from "./wasi.ts";

export type BuildResult = {
  wasm: Uint8Array;
  rawSize: number;
  cleanedSize: number;
  finalSize: number;
  hookCost: number; // worst-case execution count (guard checker)
  cbakCost: number;
  guardLog: string;
  sha256: string;
  imports: string[];
  exports: string[];
  wat: string;
  logs: string[];
};

export type BuildInput = {
  files: Record<string, string>; // every .c/.h, placed under /src; headers resolve via -I/src
  entry?: string; // the .c file to compile, default "hook.c"
  postWasm: ArrayBuffer | Uint8Array; // compiled crates/xahau-hook-wasm
  tools: { cleaner: ArrayBuffer | Uint8Array; guard: ArrayBuffer | Uint8Array }; // tools/*.wasm (WASI reactors)
  onProgress?: ProgressFn; // toolchain download progress (first run fetches ~100 MB)
};

export type ProgressFn = (doneBytes: number, totalBytes: number) => void;

// Final flags; documented in README.
export const clangArgs = (entry: string) => [
  "-target", "wasm32",
  "-O2",
  "-nostdlib",
  "-nostartfiles",
  "-Werror=implicit-function-declaration",
  "-I/src",
  "-c", `/src/${entry}`,
  "-o", "/build/hook.o",
];
export const LLD_ARGS = [
  "--no-entry",
  "--allow-undefined",
  "--export=hook",
  "/build/hook.o",
  "-o", "/build/hook.raw.wasm",
];

const dec = new TextDecoder();

/** Collects a tool's stdout/stderr into `logs`, one entry per line. */
function toolRunner(logs: string[], onProgress?: ProgressFn) {
  let pending = "";
  const sink = (bytes: Uint8Array | null) => {
    if (!bytes) return;
    pending += dec.decode(bytes);
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    logs.push(...lines);
  };
  const opts = {
    stdout: sink,
    stderr: sink,
    decodeASCII: false as const,
    fetchProgress: onProgress ? (e: { doneLength: number; totalLength: number }) => onProgress(e.doneLength, e.totalLength) : undefined,
  };
  return async (name: "clang" | "wasm-ld", args: string[], files: Tree): Promise<Tree> => {
    logs.push(`$ ${name} ${args.join(" ")}`);
    try {
      return (await commands[name](args, files, opts)) as Tree;
    } catch (e) {
      if (e instanceof Exit) throw new Error(`${name} exited with code ${e.code}\n${logs.join("\n")}`);
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
  const args = clangArgs(entry).filter((a, i, all) => a !== "-c" && all[i - 1] !== "-o" && a !== "-o");
  try {
    await run("clang", ["-fsyntax-only", ...args], { src: { ...files }, build: {} });
  } catch {
    // diagnostics are in `logs`; a non-zero exit is the expected outcome for broken code
  }
  return logs.slice(1); // drop the "$ clang ..." line
}

export async function compile(input: BuildInput): Promise<BuildResult> {
  const logs: string[] = [];
  if (input.onProgress) await prefetchToolchain(input.onProgress);
  const run = toolRunner(logs, input.onProgress);
  const entry = input.entry ?? "hook.c";

  // Fixed virtual paths: /src/<files>, /build/*
  const tree: Tree = { src: { ...input.files }, build: {} };
  const afterClang = await run("clang", clangArgs(entry), tree);
  const afterLld = await run("wasm-ld", LLD_ARGS, afterClang);
  const raw = (afterLld.build as Tree)["hook.raw.wasm"] as Uint8Array;
  logs.push(`hook.raw.wasm: ${raw.length} bytes`);

  logs.push("$ hook-cleaner");
  const cleaned = runCleaner(await toolModule(input.tools.cleaner), raw);
  logs.push(`hook.cleaned.wasm: ${cleaned.length} bytes`);

  logs.push("$ xahau-hook-wasm process");
  const post = await loadPost(input.postWasm);
  const wasm = post.process(cleaned);
  const [imports, exports] = post.info(wasm);
  const wat = post.wat(wasm);
  const sha256 = hex(await crypto.subtle.digest("SHA-256", wasm as BufferSource));
  logs.push(`hook.wasm: ${wasm.length} bytes, sha256 ${sha256}`);


  logs.push("$ guard-checker");
  const g = runGuard(await toolModule(input.tools.guard), wasm);
  logs.push(...g.log.split("\n").filter(Boolean));
  if (g.code !== 0) throw new Error(`guard-checker: ${g.code === 1 ? "invalid" : "threw"}\n${g.log}`);
  logs.push(`guard check: valid, hook cost ${g.hookCost}, cbak cost ${g.cbakCost}`);

  return {
    wasm, rawSize: raw.length, cleanedSize: cleaned.length, finalSize: wasm.length, sha256, imports, exports, wat, logs,
    hookCost: Number(g.hookCost), cbakCost: Number(g.cbakCost), guardLog: g.log,
  };
}

// Compile each tool once per input buffer; instances are fresh per build (deterministic memory).
const modules = new WeakMap<object, Promise<WebAssembly.Module>>();
function toolModule(bytes: ArrayBuffer | Uint8Array): Promise<WebAssembly.Module> {
  let m = modules.get(bytes);
  if (!m) modules.set(bytes, (m = WebAssembly.compile(bytes as BufferSource)));
  return m;
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

const LOG_CAP = 65536;
function runGuard(mod: WebAssembly.Module, wasm: Uint8Array) {
  const r = instantiateReactor(mod);
  const ex = r.exports;
  let code = 2;
  let hookCost = 0n;
  let cbakCost = 0n;
  let log = "";
  try {
    const p = ex.malloc(wasm.length) as number;
    const costs = ex.malloc(16) as number;
    const logBuf = ex.malloc(LOG_CAP) as number;
    const logLenPtr = ex.malloc(4) as number;
    new Uint8Array(ex.memory.buffer).set(wasm, p);
    code = ex.rshooks_validate_guards(p, wasm.length, costs, costs + 8, logBuf, LOG_CAP, logLenPtr) as number;
    const dv = new DataView(ex.memory.buffer);
    hookCost = dv.getBigUint64(costs, true);
    cbakCost = dv.getBigUint64(costs + 8, true);
    const n = Math.min(dv.getUint32(logLenPtr, true), LOG_CAP);
    log = dec.decode(new Uint8Array(ex.memory.buffer, logBuf, n));
  } catch (e) {
    // A wasm trap means malformed input (or the C++ throw stub): same as code 2.
    log = e instanceof Error ? e.message : String(e);
    if (r.output()) log += `\n${r.output()}`;
  }
  return { code, hookCost, cbakCost, log };
}

// Raw ABI of crates/xahau-hook-wasm (no wasm-bindgen): alloc, call, read result.
async function loadPost(bytes: ArrayBuffer | Uint8Array) {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
  const ex = instance.exports as Record<string, Function> & { memory: WebAssembly.Memory };
  const call = (fn: "process_raw" | "info_raw" | "wat_raw", input: Uint8Array): Uint8Array => {
    const ptr = ex.alloc_bytes(input.length) as number;
    new Uint8Array(ex.memory.buffer).set(input, ptr);
    const ok = ex[fn](ptr, input.length) as number;
    ex.free_bytes(ptr, input.length);
    const out = new Uint8Array(ex.memory.buffer, ex.result_ptr() as number, ex.result_len() as number).slice();
    if (!ok) throw new Error(`xahau-hook-wasm: ${dec.decode(out)}`);
    return out;
  };
  return {
    process: (raw: Uint8Array) => call("process_raw", raw),
    wat: (wasm: Uint8Array) => dec.decode(call("wat_raw", wasm)),
    info: (wasm: Uint8Array): [string[], string[]] => {
      const [i, e] = dec.decode(call("info_raw", wasm)).split("\0");
      return [i ? i.split("\n") : [], e ? e.split("\n") : []];
    },
  };
}

function hex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
