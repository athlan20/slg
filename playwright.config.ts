import { defineConfig } from '@playwright/test';

// 浏览器端到端场景放在 test/e2e/；根 test/ 其余子目录留给 WS 客户端联调场景，
// 不落入 Playwright 的默认匹配范围。
// passWithNoTests 是 CLI 旗标而非配置项，放在 package.json 的 test:e2e script 里。
//
// webServer 自动拉起三个进程（详见 test/README.md 的前置条件）：
// - backend API：就绪探测走 GET /health；BUILD_SECONDS 压到 3 秒便于等待 Worker 结算；
// - backend Worker：无 HTTP 端点，不做就绪探测（任务轮询周期 1s）。建造时长由 API（开工）
//   与 Worker（队首激活）共同使用，两边都要压到 3 秒，否则队列激活会按默认 60 秒计算；
// - 前端 dev server：固定 5175 端口，避开 8424 的常驻开发实例。
export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5175' },
  webServer: [
    {
      command: 'npm run api',
      cwd: 'backend',
      url: 'http://127.0.0.1:8080/health',
      reuseExistingServer: true,
      env: { ...process.env, BUILD_SECONDS: '3' },
    },
    {
      command: 'npm run worker',
      cwd: 'backend',
      env: { ...process.env, BUILD_SECONDS: '3' },
    },
    {
      command: 'npm run dev -- --port 5175',
      cwd: 'frontend',
      url: 'http://localhost:5175',
      reuseExistingServer: true,
    },
  ],
});
