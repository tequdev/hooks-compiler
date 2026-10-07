import { commands, Exit, type Tree } from "@yowasp/clang";

export type BuildResult = {
  wasm: Uint8Array;
  rawSize: number;
  finalSize: number;
  sha256: string;
  imports: string[];
  exports: string[];
  wat: string;
  logs: string[];
};

export type BuildInput = {
  source: string;
  header: string; // contents of hookapi/hookapi.h
  postWasm: ArrayBuffer | Uint8Array; // compiled crates/xahau-hook-wasm
};

// Final flags; documented in README.
export const CLANG_ARGS = [
  "-target", "wasm32",
  "-O2",
  "-nostdlib",
  "-nostartfiles",
  "-Werror=implicit-function-declaration",
  "-I/include",
  "-c", "/src/hook.c",
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

export async function compile(input: BuildInput): Promise<BuildResult> {
  const logs: string[] = [];
  let pending = "";
  const sink = (bytes: Uint8Array | null) => {
    if (!bytes) return;
    pending += dec.decode(bytes);
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    logs.push(...lines);
  };
  const opts = { stdout: sink, stderr: sink, decodeASCII: false as const };
  const run = async (name: "clang" | "wasm-ld", args: string[], files: Tree): Promise<Tree> => {
    logs.push(`$ ${name} ${args.join(" ")}`);
    try {
      return (await commands[name](args, files, opts)) as Tree;
    } catch (e) {
      if (e instanceof Exit) throw new Error(`${name} exited with code ${e.code}\n${logs.join("\n")}`);
      throw e;
    }
  };

  // Fixed virtual paths: /src/hook.c, /include/hookapi.h, /build/*
  const tree: Tree = { src: { "hook.c": input.source }, include: { "hookapi.h": input.header }, build: {} };
  const afterClang = await run("clang", CLANG_ARGS, tree);
  const afterLld = await run("wasm-ld", LLD_ARGS, afterClang);
  const raw = (afterLld.build as Tree)["hook.raw.wasm"] as Uint8Array;
  logs.push(`hook.raw.wasm: ${raw.length} bytes`);

  logs.push("$ xahau-hook-wasm process");
  const post = await loadPost(input.postWasm);
  const wasm = post.process(raw);
  const [imports, exports] = post.info(wasm);
  const wat = post.wat(wasm);
  const sha256 = hex(await crypto.subtle.digest("SHA-256", wasm as BufferSource));
  logs.push(`hook.wasm: ${wasm.length} bytes, sha256 ${sha256}`);

  return { wasm, rawSize: raw.length, finalSize: wasm.length, sha256, imports, exports, wat, logs };
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
