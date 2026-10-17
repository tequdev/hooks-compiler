// Builds src/worker.ts as a standalone ES-module worker bundle (dist/standalone/, published as-is), so any app can
// copy it and `new Worker("/compiler/worker.js", { type: "module" })`. The toolchain assets are not bundled
// (28 MB, already in @live-codes/clang-wasm): `hooks-compiler copy-assets <dir>` puts clang/, binaryen.js and
// hook-cleaner.wasm beside worker.js.
import { defineConfig } from "vite";

export default defineConfig({
  base: "./", // asset URLs relative to worker.js, so the folder can live anywhere (e.g. /compiler/)
  publicDir: false, // do not copy the demo's toolchain assets into the bundle
  build: {
    outDir: "dist/standalone",
    target: "esnext",
    rollupOptions: {
      input: "src/worker.ts",
      output: { format: "es", entryFileNames: "worker.js", assetFileNames: "[name][extname]", chunkFileNames: "[name].js" },
    },
  },
});
