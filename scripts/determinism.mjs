// Build every test/fixtures/hooks/<name>/*.c with the built CLI (needs `pnpm build`) and compare sha256 with test/fixtures/hashes.json.
// `--update` rewrites hashes.json instead. Each hook is built twice; differing hashes fail.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const update = process.argv.includes("--update");
const out = "test-results/determinism"; // a fixed path so CI can upload it on failure; test-results is gitignored
mkdirSync(out, { recursive: true });
const expected = update ? {} : JSON.parse(readFileSync("test/fixtures/hashes.json", "utf8"));
const actual = {};
let failed = false;
const report = (name, msg) => {
  console.log(`${name.padEnd(12)} ${msg}`);
  if (!msg.startsWith("ok")) failed = true;
};

const build = (name, entry, run) => {
  const wasm = join(out, `${name}-${run}.wasm`);
  const json = execFileSync(process.execPath, ["dist/cli.js", "build", entry, "-I", "test/fixtures/include", "-o", wasm, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(json).sha256;
};

for (const name of readdirSync("test/fixtures/hooks").sort()) {
  const entry = `test/fixtures/hooks/${name}/${readdirSync(`test/fixtures/hooks/${name}`).find((f) => f.endsWith(".c"))}`;
  let hash;
  try {
    hash = build(name, entry, 1);
    if (build(name, entry, 2) !== hash) {
      report(name, "NONDETERMINISTIC (two builds differ)");
      continue;
    }
  } catch (e) {
    report(name, `BUILD FAILED\n${e.stderr ?? e.message}`);
    continue;
  }
  actual[name] = hash;
  if (update) report(name, `ok updated ${hash}`);
  else if (!expected[name]) report(name, `MISSING from hashes.json, got ${hash}`);
  else if (expected[name] !== hash) report(name, `MISMATCH expected ${expected[name]} got ${hash}`);
  else report(name, `ok ${hash}`);
}
if (update && !failed) writeFileSync("test/fixtures/hashes.json", `${JSON.stringify(actual, null, 2)}\n`);
process.exit(failed ? 1 : 0);
