// Node equivalent of the UI determinism check: `pnpm test:determinism`.
import { readFile } from "node:fs/promises";
import { compile } from "../src/compiler.ts";

const [source, header, postWasm, cleaner, guard] = await Promise.all([
  readFile("examples/hello.c", "utf8"),
  readFile("hookapi/hookapi.h", "utf8"),
  readFile("public/xahau-hook-wasm.wasm"),
  readFile("public/hook-cleaner.wasm"),
  readFile("public/guard-checker.wasm"),
]);

const hashes: string[] = [];
for (let i = 0; i < 3; i++) {
  const r = await compile({ files: { "hook.c": source, "hookapi.h": header }, postWasm, tools: { cleaner, guard } });
  hashes.push(r.sha256);
  console.log(`build ${i + 1}: raw=${r.rawSize} cleaned=${r.cleanedSize} final=${r.finalSize} sha256=${r.sha256}`);
  if (i === 0) console.log(`imports: ${r.imports.join(", ")}\nexports: ${r.exports.join(", ")}\nhookCost: ${r.hookCost} cbakCost: ${r.cbakCost}`);
}
const ok = hashes.every((h) => h === hashes[0]);
console.log(`Deterministic: ${ok ? "YES" : "NO"}`);
process.exit(ok ? 0 : 1);
