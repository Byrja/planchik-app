import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'telegram-ios', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'telegram-android', use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
  ],
});
