import { readFile } from "node:fs/promises";
import { type Binaryen, type Compiler, createApi, type ToolchainOptions } from "./core.ts";

export type { CheckInput, CompileInput, CompileResult, Compiler, OptLevel, ProgressFn, ToolchainOptions } from "./core.ts";
export { VERSIONS } from "./core.ts";

let binaryen: Promise<Binaryen> | undefined;

export const { compile, check, prefetchToolchain } = createApi({
  readCleaner: () => readFile(new URL("./hook-cleaner.wasm", import.meta.url)),
  loadBinaryen: () => (binaryen ??= import("binaryen").then((m) => m.default)),
});

/** Same shape as the browser `createCompiler`, but runs inline in this process. */
export function createCompiler(opts: ToolchainOptions = {}): Compiler {
  return {
    compile: (input) => compile({ ...input, ...opts }),
    check: (input) => check({ ...input, ...opts }),
    prefetch: () => prefetchToolchain(opts),
    terminate() {},
  };
}
