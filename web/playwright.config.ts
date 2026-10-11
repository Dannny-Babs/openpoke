import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 30_000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3013', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: [
    { command: '../.venv/bin/python ../scripts/preview.py --demo --port 8003', url: 'http://127.0.0.1:8003/api/v1/health', reuseExistingServer: false, timeout: 30_000 },
    { command: 'OPENPOKE_DEMO=1 PY_SERVER_URL=http://127.0.0.1:8003 npm run start -- --hostname 127.0.0.1 --port 3013', url: 'http://127.0.0.1:3013', reuseExistingServer: false, timeout: 30_000 }
  ]
});
