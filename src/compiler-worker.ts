import header from "../hookapi/hookapi.h?raw";
import { compile, type BuildResult } from "./compiler.ts";

const bytes = (url: string) => fetch(url).then((r) => r.arrayBuffer());
const postWasm = bytes("/xahau-hook-wasm.wasm");
const tools = Promise.all([bytes("/hook-cleaner.wasm"), bytes("/guard-checker.wasm")]).then(([cleaner, guard]) => ({ cleaner, guard }));

const worker = self as unknown as Worker; // DedicatedWorkerGlobalScope, without the WebWorker lib

worker.onmessage = async (ev: MessageEvent<{ id: number; source: string }>) => {
  const { id, source } = ev.data;
  try {
    const result: BuildResult = await compile({ files: { "hook.c": source, "hookapi.h": header }, postWasm: await postWasm, tools: await tools });
    worker.postMessage({ id, result }, [result.wasm.buffer as ArrayBuffer]);
  } catch (e) {
    worker.postMessage({ id, error: String(e instanceof Error ? e.message : e) });
  }
};
