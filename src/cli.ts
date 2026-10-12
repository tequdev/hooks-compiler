#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { compile, type OptLevel } from "./index.ts";

const { positionals: paths, values } = parseArgs({
  allowPositionals: true,
  options: { output: { type: "string", short: "o" }, O: { type: "string", short: "O" } }, // -O2 → O: "2"
});
const opt = values.O ? (`-O${values.O}` as OptLevel) : undefined;
const usage = "usage: hooks-compiler <entry.c> [more .c/.h files...] [-o out.wasm] [-O0|-O1|-O2|-O3|-Os|-Oz]";
try {
  if (!paths.length) throw new Error(usage);
  const files = Object.fromEntries(await Promise.all(paths.map(async (p) => [basename(p), await readFile(p, "utf8")])));
  const entry = basename(paths[0]);
  const r = await compile({ files, entry, opt, onProgress: (f) => process.stderr.write(`\rtoolchain ${Math.floor(f * 100)}%`) });
  console.error(r.logs.join("\n"));
  const out = values.output ?? entry.replace(/\.c$/, "") + ".wasm";
  await writeFile(out, r.wasm);
  console.log(`${out} ${r.finalSize} bytes sha256 ${r.sha256}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
