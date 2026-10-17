import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "node_modules/@live-codes/clang-wasm/assets", // the demo serves the toolchain straight from node_modules
  optimizeDeps: { esbuildOptions: { target: "esnext" } }, // binaryen.js uses top-level await
  worker: { format: "es" },
  build: { target: "esnext" },
});
