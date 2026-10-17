// Compiles tools/hook-cleaner/cleaner.c to a WASI reactor wasm with @live-codes/clang-wasm: `pnpm prepare`.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { compilerDiagnostics, createToolchain } from "@live-codes/clang-wasm/toolchain";

// The shipped sysroot has no crt1-reactor.o, so -mexec-model=reactor is impossible: link
// with --no-entry and export this stub, the equivalent of wasi-libc's crt1-reactor.c.
const initC =
  'extern void __wasm_call_ctors(void);\n__attribute__((export_name("_initialize"))) void _initialize(void) { __wasm_call_ctors(); }\n';

const tc = await createToolchain();
const { runtime } = tc;
const [clang, lld] = await Promise.all([runtime.getModule(runtime.assetUrls.clang), runtime.getModule(runtime.assetUrls.lld)]);
const cleanerC = await readFile("tools/hook-cleaner/cleaner.c", "utf8");

const wasm = await tc.lock(async () => {
  tc.addFile("src/cleaner.c", cleanerC);
  tc.addFile("src/init.c", initC);
  runtime.memfs.addDirectory("build");
  const run = async (mod: WebAssembly.Module, name: string, args: string[]) => {
    console.log(`$ ${name} ${args.join(" ")}`);
    const { raw, error } = await tc.captureCompilerOutput(() => runtime.run(mod, true, name, ...args));
    if (raw) console.error(compilerDiagnostics(raw).join("\n"));
    if (error) throw new Error(`${name} failed: ${error.message}`);
  };
  const cc = (src: string, obj: string) =>
    run(clang, "clang", ["-target", "wasm32-wasi", "--sysroot=/", "-O2", "-w", "-c", src, "-o", obj]);
  await cc("/src/cleaner.c", "/build/cleaner.o");
  await cc("/src/init.c", "/build/init.o");
  await run(lld, "wasm-ld", [
    "--no-entry",
    "--export=cleaner",
    "--export=malloc",
    "--export=_initialize",
    "--strip-all",
    "-L/lib/wasm32-wasi",
    "/build/cleaner.o",
    "/build/init.o",
    "-lc",
    `/${runtime.compilerConfig.compilerRuntimeLibDir}/libclang_rt.builtins-wasm32.a`,
    "-o",
    "/build/hook-cleaner.wasm",
  ]);
  return Uint8Array.from(runtime.memfs.getFileContents("/build/hook-cleaner.wasm"));
});
await writeFile("src/hook-cleaner.wasm", wasm);
console.log(`src/hook-cleaner.wasm: ${wasm.length} bytes sha256 ${createHash("sha256").update(wasm).digest("hex")}`);
