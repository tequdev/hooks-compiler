// Split from index.ts so worker.ts can import it without pulling in createCompiler's
// `new Worker(new URL("./worker.js", ...))`, which bundlers would follow back into the worker (infinite recursion).
import { type Binaryen, createApi } from "./core.ts";
import { importUrl } from "./dynamic-import.js";

// binaryen.js is a 15 MB single-line file that bundlers choke on, so it is never imported by name:
// it is loaded at runtime from the directory `copy-assets` wrote.
const binaryen = new Map<string, Promise<Binaryen>>();
function loadBinaryen(baseUrl?: string | URL): Promise<Binaryen> {
  if (baseUrl === undefined) throw new Error("baseUrl is required in browsers");
  const url = new URL("binaryen.js", baseUrl).href;
  let p = binaryen.get(url);
  if (!p) {
    p = importUrl(url).then((m) => m.default as Binaryen);
    binaryen.set(url, p);
    p.catch(() => binaryen.delete(url)); // allow a retry
  }
  return p;
}

// Bundlers emit the wasm as an asset from the `new URL(..., import.meta.url)`.
export const { compile, check, prefetchToolchain } = createApi({
  readCleaner: async () => {
    const res = await fetch(new URL("./hook-cleaner.wasm", import.meta.url));
    if (!res.ok) throw new Error(`failed to load hook-cleaner.wasm: HTTP ${res.status} ${res.url}`);
    return res.arrayBuffer();
  },
  loadBinaryen,
});
