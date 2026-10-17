import { readFile } from "node:fs/promises";
import { type Compiler, createApi, type ToolchainOptions } from "./core.ts";

export type { CompileInput, CompileResult, Compiler, OptLevel, ProgressFn, ToolchainOptions } from "./core.ts";
export { VERSIONS } from "./core.ts";

export const { compile, check, prefetchToolchain } = createApi(() => readFile(new URL("./hook-cleaner.wasm", import.meta.url)));

/** Same shape as the browser `createCompiler`, but runs inline in this process. */
export function createCompiler(opts: ToolchainOptions = {}): Compiler {
  return {
    compile: (input) => compile({ ...input, ...opts }),
    check: (files, entry) => check(files, entry, opts),
    prefetch: () => prefetchToolchain(opts),
    terminate() {},
  };
}
