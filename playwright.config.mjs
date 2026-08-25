import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }]
  ],
  use: {
    baseURL: "http://127.0.0.1:4191",
    locale: "ar-SA",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node e2e/qa-server.mjs",
    url: "http://127.0.0.1:4191/qa/",
    reuseExistingServer: false,
    timeout: 30000
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } }
  ]
});
