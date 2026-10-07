import header from "../hookapi/hookapi.h?raw";
import { compile, type BuildResult } from "./compiler.ts";

const postWasm = fetch("/xahau-hook-wasm.wasm").then((r) => r.arrayBuffer());

const worker = self as unknown as Worker; // DedicatedWorkerGlobalScope, without the WebWorker lib

worker.onmessage = async (ev: MessageEvent<{ id: number; source: string }>) => {
  const { id, source } = ev.data;
  try {
    const result: BuildResult = await compile({ source, header, postWasm: await postWasm });
    worker.postMessage({ id, result }, [result.wasm.buffer as ArrayBuffer]);
  } catch (e) {
    worker.postMessage({ id, error: String(e instanceof Error ? e.message : e) });
  }
};
