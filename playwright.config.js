import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/browser',
  use: { baseURL: 'http://127.0.0.1:4173', timezoneId: 'UTC', locale: 'en-US' },
  webServer: { command: 'node test/browser/server.js', url: 'http://127.0.0.1:4173/', reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
