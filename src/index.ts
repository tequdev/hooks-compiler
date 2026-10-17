import { check, compile, prefetchToolchain } from "./browser-api.ts";
import type { Compiler, ToolchainOptions } from "./core.ts";
import type { WorkerRequest, WorkerResponse } from "./worker.ts";

export type { CheckInput, CompileInput, CompileResult, Compiler, OptLevel, ProgressFn, ToolchainOptions } from "./core.ts";
export { VERSIONS } from "./core.ts";
export { check, compile, prefetchToolchain };

type Pending = { resolve(m: WorkerResponse): void; reject(e: Error): void; onProgress?: (f: number) => void };

/** Runs the pipeline in a Web Worker (`opts.worker`, or the one bundled with this package) behind promises. */
export function createCompiler(opts: ToolchainOptions & { worker?: Worker } = {}): Compiler {
  const worker = opts.worker ?? new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  // resolved against the page here: inside the worker a relative URL would resolve against the worker script
  const baseUrl = opts.baseUrl === undefined ? undefined : new URL(opts.baseUrl, location.href).href.replace(/([^/])$/, "$1/");
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let dead: Error | undefined; // once the worker failed or was terminated, calls would hang forever
  const failAll = (err: Error) => {
    dead = err;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  worker.addEventListener("error", (ev) => failAll(new Error(ev.message || "worker error")));
  worker.addEventListener("messageerror", () => failAll(new Error("worker message could not be deserialized")));
  worker.addEventListener("message", (ev: MessageEvent<WorkerResponse>) => {
    const m = ev.data;
    const p = pending.get(m.id);
    if (!p) return;
    if ("progress" in m) return p.onProgress?.(m.progress);
    pending.delete(m.id);
    if ("error" in m) p.reject(new Error(m.error));
    else p.resolve(m);
  });
  const call = (req: Distribute<WorkerRequest>): Promise<WorkerResponse> =>
    new Promise((resolve, reject) => {
      if (dead) return reject(dead);
      const id = nextId++;
      pending.set(id, { resolve, reject, onProgress: opts.onProgress });
      worker.postMessage({ ...req, id, baseUrl });
    });
  return {
    compile: async (input) => ((await call({ type: "compile", ...input })) as Extract<WorkerResponse, { result: unknown }>).result,
    check: async (input) => ((await call({ type: "check", ...input })) as Extract<WorkerResponse, { lines: unknown }>).lines,
    prefetch: async () => void (await call({ type: "prefetch" })),
    terminate: () => {
      failAll(new Error("compiler terminated"));
      worker.terminate();
    },
  };
}

type Distribute<T> = T extends unknown ? Omit<T, "id" | "baseUrl"> : never;
