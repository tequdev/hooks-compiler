import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  use: { baseURL: "http://localhost:5199" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: { command: "pnpm dev --port 5199", url: "http://localhost:5199", reuseExistingServer: !process.env.CI },
});
