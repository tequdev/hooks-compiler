// Compiles tools/hook-cleaner/cleaner.c to a WASI reactor wasm with @yowasp/clang: `pnpm prepare`.
import { commands, Exit, type Tree } from "@yowasp/clang";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const log = (b: Uint8Array | null) => b && process.stderr.write(b);
const args = [
  "-target", "wasm32-wasip1", "-O2", "-mexec-model=reactor", "-w",
  "-Wl,--export=cleaner,--export=malloc",
  "/src/cleaner.c", "-o", "/build/hook-cleaner.wasm",
];
console.log(`$ clang ${args.join(" ")}`);
let result: Tree;
try {
  result = (await commands.clang(args, { src: { "cleaner.c": await readFile("tools/hook-cleaner/cleaner.c", "utf8") }, build: {} }, { stdout: log, stderr: log, decodeASCII: false })) as Tree;
} catch (e) {
  if (e instanceof Exit) throw new Error(`clang exited with code ${e.code}`);
  throw e;
}
const wasm = (result.build as Tree)["hook-cleaner.wasm"] as Uint8Array;
await writeFile("src/hook-cleaner.wasm", wasm);
console.log(`src/hook-cleaner.wasm: ${wasm.length} bytes sha256 ${createHash("sha256").update(wasm).digest("hex")}`);
