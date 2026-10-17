#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { check, compile, type OptLevel } from "./index.node.ts";

const usage = `usage:
  hooks-compiler build <entry.c> [more .c/.h files...] [-I <dir>]... [-o out.wasm] [-O0|-O1|-O2|-O3|-Os|-Oz] [--wat] [--json]
  hooks-compiler check <entry.c> [more files...] [-I <dir>]...
  hooks-compiler copy-assets [directory]   (default ./compiler; pass its served URL as baseUrl)

-I <dir>  add every file under dir (keyed by its path relative to dir), repeatable; first source for a name wins
          (positional files, then -I dirs in order)`;

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    const p = join(e.parentPath, e.name);
    if (e.isFile() || (e.isSymbolicLink() && (await stat(p)).isFile())) yield p; // stat follows symlinks
  }
}

/** Positional files keyed by basename, then each -I directory in order keyed by relative path; like clang, the first source for a key wins. */
async function readSources(paths: string[], dirs: string[]) {
  const files: Record<string, string> = {};
  for (const p of paths) files[basename(p)] ??= await readFile(p, "utf8");
  for (const dir of dirs) for await (const p of walk(dir)) files[relative(dir, p).split(sep).join("/")] ??= await readFile(p, "utf8");
  return files;
}

async function build(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      O: { type: "string", short: "O" }, // -O2 → O: "2"
      I: { type: "string", short: "I", multiple: true },
      wat: { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  if (!positionals.length) fail(usage);
  const files = await readSources(positionals, values.I ?? []);
  const entry = basename(positionals[0]);
  const opt = values.O ? (`-O${values.O}` as OptLevel) : undefined;
  const r = await compile({
    files,
    entry,
    opt,
    wat: values.wat,
    onProgress: (f) => process.stderr.write(`\rtoolchain ${Math.floor(f * 100)}%`),
  });
  console.error(r.logs.join("\n"));
  const out = values.output ?? `${entry.replace(/\.c$/, "")}.wasm`;
  await writeFile(out, r.wasm);
  if (r.wat !== undefined) await writeFile(`${out.replace(/\.wasm$/, "")}.wat`, r.wat);
  if (values.json) {
    const { wasm: _, logs: __, ...rest } = r;
    console.log(JSON.stringify({ output: out, ...rest }));
  } else console.log(`${out} ${r.finalSize} bytes sha256 ${r.sha256}`);
}

async function checkCmd(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { I: { type: "string", short: "I", multiple: true } },
  });
  if (!positionals.length) fail(usage);
  const lines = await check({ files: await readSources(positionals, values.I ?? []), entry: basename(positionals[0]) });
  if (lines.length) console.log(lines.join("\n"));
  process.exitCode = lines.some((l) => l.includes("error:")) ? 1 : 0;
}

async function copyAssets(args: string[]) {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const dir = positionals[0] ?? "compiler";
  // import.meta.resolve of the bare specifier points at src/index.node.js inside the package: assets/ is one level up.
  const clangAssets = new URL("../assets/", import.meta.resolve("@live-codes/clang-wasm"));
  const standalone = new URL("./standalone/", import.meta.url);
  const copies: [URL, string][] = [
    [clangAssets, join(dir, "clang")],
    [standalone, dir], // worker.js, its lazy chunk browser.js, hook-cleaner.wasm
    [new URL(import.meta.resolve("binaryen")), join(dir, "binaryen.js")],
  ];
  await mkdir(dir, { recursive: true });
  for (const [src, dest] of copies) {
    await cp(fileURLToPath(src), dest, { recursive: true });
    console.log(dest);
  }
  console.error("serve this directory and pass its URL (with a trailing slash) as baseUrl");
}

const [cmd, ...rest] = process.argv.slice(2);
const commands: Record<string, (args: string[]) => Promise<void>> = { build, check: checkCmd, "copy-assets": copyAssets };
if (cmd === "--help" || cmd === "-h") {
  console.log(usage);
} else {
  try {
    await (commands[cmd] ?? (() => fail(usage)))(rest);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}
