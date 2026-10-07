// Compiles tools/* to WASI reactor wasm with @yowasp/clang: `pnpm build:tools`.
import { commands, Exit, type Tree } from "@yowasp/clang";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";

const log = (b: Uint8Array | null) => b && process.stderr.write(b);
const opts = { stdout: log, stderr: log, decodeASCII: false as const };

async function dir(path: string): Promise<Tree> {
  const out: Tree = {};
  for (const f of await readdir(path)) if (/\.(c|cpp|h|macro)$/.test(f)) out[f] = await readFile(`${path}/${f}`, "utf8");
  return out;
}

async function build(tool: "clang" | "clang++", args: string[], files: Tree, out: string) {
  console.log(`$ ${tool} ${args.join(" ")}`);
  let result: Tree;
  try {
    result = (await commands[tool](args, files, opts)) as Tree;
  } catch (e) {
    if (e instanceof Exit) throw new Error(`${tool} exited with code ${e.code}`);
    throw e;
  }
  const wasm = (result.build as Tree)[out] as Uint8Array;
  await writeFile(`public/${out}`, wasm);
  console.log(`public/${out}: ${wasm.length} bytes sha256 ${createHash("sha256").update(wasm).digest("hex")}`);
}

const common = ["-target", "wasm32-wasip1", "-O2", "-mexec-model=reactor", "-w"];

await build(
  "clang",
  [...common, "-Wl,--export=cleaner,--export=malloc,--export=free", "/src/cleaner.c", "-o", "/build/hook-cleaner.wasm"],
  { src: await dir("tools/hook-cleaner"), build: {} },
  "hook-cleaner.wasm",
);
await build(
  "clang++",
  [...common, "-std=c++17", "-DGUARD_CHECKER_BUILD", "-I/src",
    "-Wl,--export=rshooks_validate_guards,--export=malloc,--export=free",
    "/src/guard_shim.cpp", "/src/eh_stub.cpp", "-o", "/build/guard-checker.wasm"],
  { src: await dir("tools/guard-checker"), build: {} },
  "guard-checker.wasm",
);
