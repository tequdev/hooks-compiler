#!/usr/bin/env node
// hooks-compiler-copy-assets [directory]: copies the clang toolchain assets into a directory you serve
// (default ./clang), so hosts need no direct dependency on @live-codes/clang-wasm for its bin.
// Pass that directory's URL as `baseUrl`. Delegates to clang-wasm-copy-assets, which reads our argv.
await import(new URL("../bin/copy-assets.mjs", import.meta.resolve("@live-codes/clang-wasm")).href);
