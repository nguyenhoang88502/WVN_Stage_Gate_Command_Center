// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// launcher.ps1 resolves its own paths via $PSScriptRoot, so it runs the same
// regardless of the shell's cwd - no need to cd into system/ first.
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false, // the app is a single shared PowerShell process with
                         // one CSV-backed tracking store - parallel specs
                         // would race on the same data.
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'powershell -NoProfile -ExecutionPolicy Bypass -File "system/launcher.ps1" -NoBrowser',
    url: 'http://localhost:8080/api/data',
    reuseExistingServer: true, // if a dev server from a previous session is
                                // already up, use it rather than fail/spawn
                                // a second listener on a fallback port.
    timeout: 30000,
  },
});
