// Builds src/compiler-worker.ts as a standalone ES-module worker bundle (dist-worker/),
// with the toolchain wasm beside it, so any app can `new Worker("/compiler/worker.js", { type: "module" })`.
import { defineConfig } from "vite";

export default defineConfig({
  base: "./", // asset URLs relative to worker.js, so the folder can live anywhere (e.g. /compiler/)
  build: {
    outDir: "dist-worker",
    emptyOutDir: true,
    target: "esnext",
    assetsInlineLimit: 0,
    rollupOptions: {
      input: "src/worker-entry.ts",
      output: { format: "es", entryFileNames: "worker.js", assetFileNames: "[name][extname]", chunkFileNames: "[name].js" },
    },
  },
});
