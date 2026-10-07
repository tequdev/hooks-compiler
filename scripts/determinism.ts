// Node equivalent of the UI determinism check: `pnpm test:determinism`.
import { readFile } from "node:fs/promises";
import { compile } from "../src/compiler.ts";

const [source, header, postWasm] = await Promise.all([
  readFile("examples/hello.c", "utf8"),
  readFile("hookapi/hookapi.h", "utf8"),
  readFile("public/xahau-hook-wasm.wasm"),
]);

const hashes: string[] = [];
for (let i = 0; i < 3; i++) {
  const r = await compile({ source, header, postWasm });
  hashes.push(r.sha256);
  console.log(`build ${i + 1}: raw=${r.rawSize} final=${r.finalSize} sha256=${r.sha256}`);
  if (i === 0) console.log(`imports: ${r.imports.join(", ")}\nexports: ${r.exports.join(", ")}`);
}
const ok = hashes.every((h) => h === hashes[0]);
console.log(`Deterministic: ${ok ? "YES" : "NO"}`);
process.exit(ok ? 0 : 1);
