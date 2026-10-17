// Compile worker for any host app (`hooks-compiler/worker`, or the standalone bundle in dist/standalone).
// Protocol: post a WorkerRequest; replies are WorkerResponse messages with the same id.
import { check, compile, prefetchToolchain } from "./browser-api.ts";
import type { CompileResult, OptLevel } from "./core.ts";

export type WorkerRequest =
  | { id: number; type: "compile"; files: Record<string, string>; entry?: string; opt?: OptLevel; wat?: boolean; baseUrl?: string }
  | { id: number; type: "check"; files: Record<string, string>; entry?: string; baseUrl?: string }
  | { id: number; type: "prefetch"; baseUrl?: string };
export type WorkerResponse =
  | { id: number; progress: number } // toolchain download, 0..1
  | { id: number; result: CompileResult }
  | { id: number; lines: string[] }
  | { id: number; ok: true } // prefetch done
  | { id: number; error: string };

const worker = self as unknown as {
  onmessage: (ev: MessageEvent<WorkerRequest>) => void;
  postMessage(m: WorkerResponse, transfer?: Transferable[]): void;
};

worker.onmessage = async (ev) => {
  const req = ev.data;
  const { id } = req;
  // default suits the standalone bundle, where clang/ and binaryen.js sit beside worker.js. Resolved against the
  // worker's own URL rather than import.meta.url: bundlers treat `new URL(string, import.meta.url)` as an
  // asset reference and fail to resolve the (non-existent) directory.
  const baseUrl = req.baseUrl ?? new URL("./", self.location.href).href;
  const onProgress = (progress: number) => worker.postMessage({ id, progress });
  try {
    await prefetchToolchain({ baseUrl, onProgress });
    if (req.type === "prefetch") {
      worker.postMessage({ id, ok: true });
    } else if (req.type === "check") {
      worker.postMessage({ id, lines: await check({ files: req.files, entry: req.entry, baseUrl }) });
    } else {
      const result = await compile({ files: req.files, entry: req.entry, opt: req.opt, wat: req.wat, baseUrl, onProgress });
      worker.postMessage({ id, result }, [result.wasm.buffer as ArrayBuffer]);
    }
  } catch (e) {
    worker.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
