import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss';
import { prototypesPreview } from './tools/prototypes-preview';

// 开发/测试两套环境并存时由 dev.sh 传入：WEB_PORT 是本前端端口，API_PORT 是它默认连的后端端口
const webPort = Number(process.env.WEB_PORT || 8424);
const apiPort = Number(process.env.API_PORT || 8080);

export default defineConfig({
  plugins: [pluginReact(), pluginTailwindcss()],
  html: {
    template: './index.html',
  },
  source: {
    entry: { index: './src/main.tsx' },
    define: { __SLG_API_PORT__: JSON.stringify(apiPort) },
  },
  server: {
    port: webPort,
    setup: prototypesPreview,
  },
  output: {
    distPath: { root: 'dist' },
  },
});
