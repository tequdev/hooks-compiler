// Standalone compile worker for any host app (built by `pnpm build:worker` into dist-worker/).
// Protocol: post { id, type: "compile" | "check", files, entry?, opt? }; replies
// { id, progress } (toolchain download), { id, result } / { id, lines } or { id, error }.
import { check, compile, type OptLevel, prefetchToolchain } from "./compiler.ts";

const worker = self as unknown as Worker;
const bytes = (name: string) =>
  fetch(new URL(`./${name}`, import.meta.url)).then((r) => {
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return r.arrayBuffer();
  });
let tools: Promise<ArrayBuffer[]> | undefined;

type Req = { id: number; type: "compile" | "check"; files: Record<string, string>; entry?: string; opt?: OptLevel };

worker.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, type, files, entry = "hook.c", opt } = ev.data;
  const onProgress = (done: number, total: number) => worker.postMessage({ id, progress: { done, total } });
  try {
    await prefetchToolchain(onProgress);
    if (type === "check") {
      worker.postMessage({ id, lines: await check(files, entry) });
      return;
    }
    tools ??= Promise.all([bytes("xahau-hook-wasm.wasm"), bytes("hook-cleaner.wasm"), bytes("guard-checker.wasm")]);
    const [postWasm, cleaner, guard] = await tools;
    const result = await compile({ files, entry, opt, postWasm, tools: { cleaner, guard }, onProgress });
    worker.postMessage({ id, result }, [result.wasm.buffer as ArrayBuffer]);
  } catch (e) {
    tools = undefined;
    worker.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
