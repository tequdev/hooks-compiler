import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { check, compile, createCompiler, VERSIONS } from "../src/index.node.ts";
import { createCompiler as createBrowserCompiler } from "../src/index.ts";

const run = promisify(execFile);
const cli = ["--experimental-strip-types", "src/cli.ts"];
const files = {
  "hook.c": await readFile("examples/hello.c", "utf8"),
  "hookapi.h": await readFile("examples/include/hookapi.h", "utf8"),
};

test("same source compiles to identical, valid MVP bytes", async (t) => {
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await compile({ files, wat: i === 0 }));
  const [r] = results;
  t.diagnostic(`sha256 ${results.map((x) => x.sha256).join(" ")} raw=${r.rawSize} final=${r.finalSize}`);
  assert.ok(
    results.every((x) => x.sha256 === r.sha256),
    results.map((x) => x.sha256).join(", "),
  );
  assert.ok(WebAssembly.validate(r.wasm as BufferSource));
  assert.deepEqual(r.imports, ["env._g", "env.accept"]);
  assert.deepEqual(r.exports, ["hook"]);
  assert.ok(r.finalSize < r.rawSize);
  assert.match(r.wat ?? "", /\(module/);
  assert.equal(results[1].wat, undefined);
});

test("check() reports compiler errors", async () => {
  const lines = await check({ files: { "hook.c": "int hook(int r){ return undeclared(r); }" } });
  assert.ok(
    lines.some((l) => l.includes("error:")),
    lines.join("\n"),
  );
  assert.ok(!lines.some((l) => /process exited/.test(l)), lines.join("\n"));
});

test("changed source changes the hash, the original reproduces it (memfs overlay)", async () => {
  const a = await compile({ files });
  const changed = files["hook.c"].replace("Hello from", "Changed");
  const b = await compile({ files: { ...files, "hook.c": changed } });
  const c = await compile({ files });
  assert.notEqual(b.sha256, a.sha256);
  assert.equal(c.sha256, a.sha256);
});

test("VERSIONS match the pinned dependencies", async () => {
  const { dependencies } = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(VERSIONS.clangWasm, dependencies["@live-codes/clang-wasm"]);
  assert.equal(VERSIONS.binaryen, dependencies.binaryen);
  const pin = JSON.parse(await readFile("tools/hook-cleaner.json", "utf8"));
  assert.equal(VERSIONS.hookCleaner, pin.version);
  assert.equal(
    createHash("sha256")
      .update(await readFile("src/hook-cleaner.wasm"))
      .digest("hex"),
    pin.sha256,
  );
});

test("createCompiler() matches compile()", async () => {
  const c = createCompiler();
  assert.equal((await c.compile({ files })).sha256, (await compile({ files })).sha256);
  assert.ok((await c.check({ files: { "hook.c": "int x = ;" } })).some((l) => l.includes("error:")));
  await c.prefetch();
  c.terminate();
});

test("createCompiler rejects pending and later calls after a worker error or terminate()", async () => {
  const fake = () => {
    const listeners: Record<string, (ev: unknown) => void> = {}; // createCompiler registers one listener per type
    const worker = {
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        listeners[type] = fn;
      },
      postMessage: () => {},
      terminate: () => {},
    };
    return { worker: worker as unknown as Worker, listeners };
  };
  const input = { files: { "hook.c": "" } };

  const a = fake();
  const c = createBrowserCompiler({ worker: a.worker });
  const pending = c.compile(input);
  a.listeners.error({ message: "boom" });
  await assert.rejects(pending, /boom/);
  await assert.rejects(c.compile(input), /boom/);

  const b = createBrowserCompiler({ worker: fake().worker });
  b.terminate();
  await assert.rejects(b.compile(input), /compiler terminated/);
});

test("CLI build -I and check", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hc-"));
  const { stdout } = await run("node", [
    ...cli,
    "build",
    "examples/hello.c",
    "-I",
    "examples/include",
    "-o",
    join(dir, "hook.wasm"),
    "--json",
  ]);
  const out = JSON.parse(stdout);
  assert.equal(
    out.sha256,
    (await compile({ files: { "hello.c": files["hook.c"], "hookapi.h": files["hookapi.h"] }, entry: "hello.c" })).sha256,
  );
  assert.equal(out.output, join(dir, "hook.wasm"));

  // first -I dir wins over a later one with the same relative name
  const [a, b] = [join(dir, "a"), join(dir, "b")];
  await Promise.all([mkdir(a), mkdir(b)]);
  await writeFile(join(a, "hookapi.h"), "#error from-a\n");
  await writeFile(join(b, "hookapi.h"), files["hookapi.h"]);
  await assert.rejects(run("node", [...cli, "check", "examples/hello.c", "-I", a, "-I", b]), (e: { stdout: string }) =>
    e.stdout.includes("from-a"),
  );
  await run("node", [...cli, "check", "examples/hello.c", "-I", b, "-I", a]);

  const broken = join(dir, "broken.c");
  await writeFile(broken, "int hook(int r){ return undeclared(r); }");
  await assert.rejects(
    run("node", [...cli, "check", broken]),
    (e: { code: number; stdout: string }) => e.code === 1 && e.stdout.includes("error:"),
  );
});

test("CLI rejects an unknown -O level and unknown commands", async () => {
  await assert.rejects(
    run("node", [...cli, "build", "examples/hello.c", "-O9"]),
    (e: { code: number; stderr: string }) => e.code === 1 && /-O9/.test(e.stderr),
  );
  await assert.rejects(run("node", [...cli, "constructor"]), (e: { code: number }) => e.code === 1);
});
