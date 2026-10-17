// Builds src/worker.ts as a standalone ES-module worker bundle (dist-worker/, published as-is), so any app can
// copy it and `new Worker("/compiler/worker.js", { type: "module" })`. The toolchain assets are not bundled
// (28 MB, already in @live-codes/clang-wasm): hosts run `hooks-compiler-copy-assets <dir>/clang` beside it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "vite";

// binaryen.js is a 15 MB single-line ESM file that overflows Vite's build transforms:
// keep it external and emit it beside worker.js unchanged.
const binaryenExternal = {
  name: "binaryen-external",
  enforce: "pre" as const,
  resolveId: (id: string) => (id === "binaryen" ? { id: "./binaryen.js", external: true as const } : null),
  generateBundle(this: { emitFile(f: { type: "asset"; fileName: string; source: Uint8Array }): void }) {
    this.emitFile({ type: "asset", fileName: "binaryen.js", source: readFileSync(createRequire(import.meta.url).resolve("binaryen")) });
  },
};

export default defineConfig({
  base: "./", // asset URLs relative to worker.js, so the folder can live anywhere (e.g. /compiler/)
  publicDir: false, // do not copy public/clang into the bundle
  plugins: [binaryenExternal],
  build: {
    outDir: "dist-worker",
    emptyOutDir: true,
    target: "esnext",
    assetsInlineLimit: 0,
    rollupOptions: {
      input: "src/worker.ts",
      output: { format: "es", entryFileNames: "worker.js", assetFileNames: "[name][extname]", chunkFileNames: "[name].js" },
    },
  },
});
