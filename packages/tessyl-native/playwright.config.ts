import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  use: { baseURL: "http://127.0.0.1:3001", trace: "retain-on-failure" },
  webServer: {
    command: "npm run build --workspace=@tessyl/design-tokens && npm run build --workspace=@tessyl/native && npm run playground:build --workspace=@tessyl/native && npm run playground:start --workspace=@tessyl/native",
    cwd: "../..",
    url: "http://127.0.0.1:3001/showcase",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
