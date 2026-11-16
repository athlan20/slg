// Rsbuild 针对 Linux.do 微应用的专用构建配置（AISLG-261）。
// 输出产物为单个 IIFE app.js 与单个 app.css，且不复制 public/ 资源。

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss';

const sdkDir = process.env.MAPP_SDK_DIR;
if (!sdkDir) {
  throw new Error(
    '[MAPP] 未设置 MAPP_SDK_DIR 环境变量。微应用构建需要指定平台 SDK 目录，例如：\n' +
    '  export MAPP_SDK_DIR=/private/tmp/claude-501/-Users-mac-work-slg/753d14ec-60d2-459f-b8f0-6137837ddb57/scratchpad/guide/sdk'
  );
}

if (!existsSync(sdkDir)) {
  throw new Error(`[MAPP] MAPP_SDK_DIR 目录不存在: ${sdkDir}`);
}

export default defineConfig({
  plugins: [pluginReact(), pluginTailwindcss()],
  source: {
    entry: { app: './src/mapp/index.tsx' },
    define: {
      __MAPP__: JSON.stringify(true),
      __SLG_API_PORT__: JSON.stringify(8080),
    },
  },
  resolve: {
    alias: {
      '@discourse-mini-app/sdk/pack': resolve(sdkDir, 'pack.mjs'),
      '@discourse-mini-app/sdk/network': resolve(sdkDir, 'network-tools.mjs'),
      '@discourse-mini-app/sdk': resolve(sdkDir, 'index.mjs'),
    },
  },
  server: {
    publicDir: false,
  },
  output: {
    distPath: {
      root: 'dist-mapp/web',
      js: '',
      css: '',
    },
    filename: {
      js: 'app.js',
      css: 'app.css',
    },
    cleanDistPath: true,
    legalComments: 'none',
    sourceMap: {
      js: false,
      css: false,
    },
  },
  performance: {
    chunkSplit: {
      strategy: 'all-in-one',
    },
  },
  tools: {
    htmlPlugin: false,
    rspack: {
      output: {
        iife: true,
      },
    },
  },
});
