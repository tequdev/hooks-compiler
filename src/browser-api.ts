// Split from index.ts so worker.ts can import it without pulling in createCompiler's
// `new Worker(new URL("./worker.js", ...))`, which bundlers would follow back into the worker (infinite recursion).
import { createApi } from "./core.ts";

// Bundlers emit the wasm as an asset from the `new URL(..., import.meta.url)`.
export const { compile, check, prefetchToolchain } = createApi(async () => {
  const res = await fetch(new URL("./hook-cleaner.wasm", import.meta.url));
  if (!res.ok) throw new Error(`failed to load hook-cleaner.wasm: HTTP ${res.status} ${res.url}`);
  return res.arrayBuffer();
});
