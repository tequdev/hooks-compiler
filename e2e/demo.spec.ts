import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { compile } from "../src/index.node.ts";

const files = {
  "hook.c": await readFile("examples/hello.c", "utf8"),
  "hookapi.h": await readFile("examples/include/hookapi.h", "utf8"),
};
const expected = (await compile({ files })).sha256;

test("demo compiles deterministically and matches the Node hash", async ({ page }) => {
  await page.goto("/");
  await page.click("#compile");
  await expect(page.locator("#deterministic")).toHaveText("Deterministic: YES", { timeout: 150_000 });
  await expect(page.locator("#sha256")).toHaveText(expected);
});

// Needs `pnpm build`: the dev server serves dist/standalone/ as /compiler/ (see vite.config.ts).
test("standalone worker.js compiles to the Node hash", async ({ page }) => {
  await page.goto("/");
  const sha256 = await page.evaluate(
    (files) =>
      new Promise<string>((resolve, reject) => {
        const worker = new Worker("/compiler/worker.js", { type: "module" });
        worker.addEventListener("error", (ev) => reject(new Error(ev.message || "worker error")));
        worker.addEventListener("message", (ev) => {
          if ("error" in ev.data) reject(new Error(ev.data.error));
          else if ("result" in ev.data) resolve(ev.data.result.sha256);
        });
        worker.postMessage({ id: 1, type: "compile", files });
      }),
    files,
  );
  expect(sha256).toBe(expected);
});
