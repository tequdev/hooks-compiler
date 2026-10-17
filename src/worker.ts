// Compile worker for any host app (`hooks-compiler/worker`, or the standalone bundle from `pnpm build:worker`).
// Protocol: post a WorkerRequest; replies are WorkerResponse messages with the same id.
import { check, compile, type CompileResult, type OptLevel, prefetchToolchain } from "./index.ts";

export type WorkerRequest = { id: number; type: "compile" | "check"; files: Record<string, string>; entry?: string; opt?: OptLevel; baseUrl?: string };
export type WorkerResponse =
  | { id: number; progress: number } // toolchain download, 0..1
  | { id: number; result: CompileResult }
  | { id: number; lines: string[] }
  | { id: number; error: string };

const worker = self as unknown as { onmessage: (ev: MessageEvent<WorkerRequest>) => void; postMessage(m: WorkerResponse, transfer?: Transferable[]): void };

worker.onmessage = async (ev) => {
  // default suits the standalone bundle, where clang/ sits beside worker.js. Resolved against the
  // worker's own URL rather than import.meta.url: bundlers treat `new URL(string, import.meta.url)` as an
  // asset reference and fail to resolve the (non-existent) ./clang/ directory.
  const { id, type, files, entry = "hook.c", opt, baseUrl = new URL("./clang/", self.location.href).href } = ev.data;
  const onProgress = (progress: number) => worker.postMessage({ id, progress });
  try {
    await prefetchToolchain({ baseUrl, onProgress });
    if (type === "check") {
      worker.postMessage({ id, lines: await check(files, entry, { baseUrl }) });
      return;
    }
    const result = await compile({ files, entry, opt, baseUrl, onProgress });
    worker.postMessage({ id, result }, [result.wasm.buffer as ArrayBuffer]);
  } catch (e) {
    worker.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
