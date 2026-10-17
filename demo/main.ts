import "@digital-go-jp/design-tokens/dist/tokens-simple.css";
import hello from "../examples/hello.c?raw";
import header from "../examples/include/hookapi.h?raw";
import { type CompileResult, createCompiler } from "../src/index.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const source = $<HTMLTextAreaElement>("source");
const log = $<HTMLPreElement>("log");
const button = $<HTMLButtonElement>("compile");
source.value = hello;

const compiler = createCompiler({
  worker: new Worker(new URL("../src/worker.ts", import.meta.url), { type: "module" }),
  baseUrl: "/compiler/",
});
const build = (src: string) => compiler.compile({ files: { "hook.c": src, "hookapi.h": header }, wat: true });

const RUNS = 3;
button.onclick = async () => {
  button.disabled = true;
  log.textContent = `compiling ${RUNS}x (first run also loads ~28 MB of clang/lld wasm)...\n`;
  $("deterministic").textContent = "";
  $<HTMLAnchorElement>("download").hidden = true;
  try {
    const results: CompileResult[] = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await build(source.value);
      results.push(r);
      log.textContent += `--- build ${i + 1} ---\n${r.logs.join("\n")}\n`;
    }
    const [r] = results;
    $("raw-size").textContent = String(r.rawSize);
    $("optimized-size").textContent = String(r.optimizedSize);
    $("final-size").textContent = String(r.finalSize);
    $("sha256").textContent = r.sha256;
    $("imports").textContent = r.imports.join("\n") || "(none)";
    $("exports").textContent = r.exports.join("\n") || "(none)";
    $("wat").textContent = r.wat ?? "";
    const deterministic = results.every((x) => x.sha256 === r.sha256);
    const status = $("deterministic");
    status.textContent = `Deterministic: ${deterministic ? "YES" : "NO"}`;
    status.className = `status ${deterministic ? "ok" : "ng"}`;
    if (!deterministic) throw new Error(`hashes differ: ${results.map((x) => x.sha256).join(", ")}`);
    const a = $<HTMLAnchorElement>("download");
    a.href = URL.createObjectURL(new Blob([r.wasm as BlobPart], { type: "application/wasm" }));
    a.hidden = false;
  } catch (e) {
    log.textContent += `\nERROR: ${e instanceof Error ? e.message : e}\n`;
    $("deterministic").textContent = "Deterministic: FAILED";
    $("deterministic").className = "status ng";
  } finally {
    button.disabled = false;
  }
};
