import { defineConfig } from "vite";

export default defineConfig({
  // Keep the toolchain out of esbuild pre-bundling so its
  // `new URL("./llvm.core.wasm", import.meta.url)` asset references survive.
  optimizeDeps: { exclude: ["@yowasp/clang"], esbuildOptions: { target: "esnext" } }, // binaryen.js uses top-level await
  worker: { format: "es" },
  build: { target: "esnext" },
});
