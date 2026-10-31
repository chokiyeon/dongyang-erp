import "dotenv/config";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  reporter: "line",
  use: { viewport: { width: 1440, height: 1000 }, locale: "ko-KR", baseURL: "http://127.0.0.1:3030", trace: "off", screenshot: "off", video: "off", launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/usr/bin/chromium", args: ["--no-sandbox"] } },
  webServer: { command: "npm run start -- --hostname 127.0.0.1 --port 3030", url: "http://127.0.0.1:3030/login", reuseExistingServer: false, timeout: 60000 },
});
