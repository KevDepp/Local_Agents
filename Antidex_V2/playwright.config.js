// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./playwright-tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  fullyParallel: false,
  workers: 1,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
});
