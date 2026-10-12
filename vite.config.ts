import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: { esbuildOptions: { target: "esnext" } }, // binaryen.js uses top-level await
  worker: { format: "es" },
  build: { target: "esnext" },
});
