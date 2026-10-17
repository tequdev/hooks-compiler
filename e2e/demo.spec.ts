import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { compile } from "../src/index.node.ts";

test("demo compiles deterministically and matches the Node hash", async ({ page }) => {
  const files = {
    "hook.c": await readFile("examples/hello.c", "utf8"),
    "hookapi.h": await readFile("examples/include/hookapi.h", "utf8"),
  };
  const expected = (await compile({ files })).sha256;
  await page.goto("/");
  await page.click("#compile");
  await expect(page.locator("#deterministic")).toHaveText("Deterministic: YES", { timeout: 150_000 });
  await expect(page.locator("#sha256")).toHaveText(expected);
});
