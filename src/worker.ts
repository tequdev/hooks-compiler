// Compile worker for any host app (`hooks-compiler/worker`, or the standalone bundle from `pnpm build:worker`).
// Protocol: post a WorkerRequest; replies are WorkerResponse messages with the same id.
import { check, compile, type CompileResult, type OptLevel, prefetchToolchain } from "./index.ts";

export type WorkerRequest = { id: number; type: "compile" | "check"; files: Record<string, string>; entry?: string; opt?: OptLevel };
export type WorkerResponse =
  | { id: number; progress: { done: number; total: number } } // toolchain download
  | { id: number; result: CompileResult }
  | { id: number; lines: string[] }
  | { id: number; error: string };

const worker = self as unknown as { onmessage: (ev: MessageEvent<WorkerRequest>) => void; postMessage(m: WorkerResponse, transfer?: Transferable[]): void };

worker.onmessage = async (ev) => {
  const { id, type, files, entry = "hook.c", opt } = ev.data;
  const onProgress = (done: number, total: number) => worker.postMessage({ id, progress: { done, total } });
  try {
    await prefetchToolchain(onProgress);
    if (type === "check") {
      worker.postMessage({ id, lines: await check(files, entry) });
      return;
    }
    const result = await compile({ files, entry, opt, onProgress });
    worker.postMessage({ id, result }, [result.wasm.buffer as ArrayBuffer]);
  } catch (e) {
    worker.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
