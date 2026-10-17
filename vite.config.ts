import { createReadStream, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { defineConfig } from "vite";

// The demo serves the toolchain straight from node_modules at the layout `copy-assets` writes:
// /compiler/clang/* and /compiler/binaryen.js (the worker and cleaner come from the dev server).
const require = createRequire(import.meta.url);
const clangAssets = join(dirname(require.resolve("@live-codes/clang-wasm")), "../assets");
const types: Record<string, string> = {
  ".json": "application/json",
  ".js": "text/javascript",
  ".gz": "application/gzip",
  ".wasm": "application/wasm",
};

export default defineConfig({
  plugins: [
    {
      name: "serve-toolchain",
      configureServer(server) {
        server.middlewares.use("/compiler", (req, res, next) => {
          const path = decodeURIComponent((req.url ?? "").split("?")[0]);
          const file =
            path === "/binaryen.js"
              ? require.resolve("binaryen")
              : path.startsWith("/clang/") && !path.includes("..")
                ? join(clangAssets, path.slice(7))
                : undefined;
          if (!file || !statSync(file, { throwIfNoEntry: false })?.isFile()) return next();
          res.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
          createReadStream(file).pipe(res);
        });
      },
    },
  ],
});
