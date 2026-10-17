// Downloads the pinned hook-cleaner release to src/hook-cleaner.wasm: `pnpm update-cleaner [new-version]`.
// With a version it rewrites tools/hook-cleaner.json (url + version + sha256); review the diff, then commit.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const pin = JSON.parse(await readFile("tools/hook-cleaner.json", "utf8"));
const next = process.argv[2];
if (next) {
  pin.url = pin.url.replaceAll(pin.version, next);
  pin.version = next;
}
const res = await fetch(pin.url);
if (!res.ok) throw new Error(`${pin.url}: HTTP ${res.status}`);
const wasm = new Uint8Array(await res.arrayBuffer());
const sha256 = createHash("sha256").update(wasm).digest("hex");
if (next) pin.sha256 = sha256;
else if (sha256 !== pin.sha256) throw new Error(`sha256 mismatch for ${pin.url}: got ${sha256}, pinned ${pin.sha256}`);
await writeFile("src/hook-cleaner.wasm", wasm);
if (next) await writeFile("tools/hook-cleaner.json", `${JSON.stringify(pin, null, 2)}\n`);
console.log(`src/hook-cleaner.wasm (${pin.version}): ${wasm.length} bytes sha256 ${sha256}`);
