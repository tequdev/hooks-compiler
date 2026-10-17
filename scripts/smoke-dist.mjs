// Smoke test for the built package: run the compiled CLI (needs `pnpm build`).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "hc-smoke-"));
const cli = (...args) => execFileSync("node", ["dist/cli.js", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
cli("copy-assets", join(dir, "c"));
const out = JSON.parse(cli("build", "examples/hello.c", "-I", "examples/include", "-o", join(dir, "hello.wasm"), "--json"));
assert.match(out.sha256, /^[0-9a-f]{64}$/);
for (const f of ["worker.js", "browser.js", "binaryen.js", "hook-cleaner.wasm", "clang"]) assert.ok(existsSync(join(dir, "c", f)), f);
console.log(out.sha256);
