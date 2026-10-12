import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { check, compile } from "../src/index.ts";

const files = {
  "hook.c": await readFile("examples/hello.c", "utf8"),
  "hookapi.h": await readFile("examples/hookapi.h", "utf8"),
};

test("same source compiles to identical, valid MVP bytes", async (t) => {
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await compile({ files }));
  const [r] = results;
  t.diagnostic(`sha256 ${results.map((x) => x.sha256).join(" ")} raw=${r.rawSize} final=${r.finalSize}`);
  assert.ok(results.every((x) => x.sha256 === r.sha256), results.map((x) => x.sha256).join(", "));
  assert.ok(WebAssembly.validate(r.wasm as BufferSource));
  assert.deepEqual(r.imports, ["env._g", "env.accept"]);
  assert.deepEqual(r.exports, ["hook"]);
  assert.ok(r.finalSize < r.rawSize);
});

test("check() reports compiler errors", async () => {
  const lines = await check({ "hook.c": "int hook(int r){ return undeclared(r); }" });
  assert.ok(lines.some((l) => l.includes("error:")), lines.join("\n"));
});
