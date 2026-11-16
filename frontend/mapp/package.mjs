#!/usr/bin/env node
// 微应用打包脚本：将 dist-mapp/web 产物与 manifest 模板打包成 dist-mapp/package/app.zip。
// 使用 MAPP_SDK_DIR 环境变量指向的平台 pack.mjs 工具，不复制代码或入库。

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

async function main() {
  const sdkDir = process.env.MAPP_SDK_DIR;
  if (!sdkDir) {
    console.error('错误: 未设置 MAPP_SDK_DIR 环境变量。');
    console.error('请通过 MAPP_SDK_DIR 指向平台的 sdk 目录，例如:');
    console.error('  export MAPP_SDK_DIR=/path/to/guide/sdk');
    process.exit(1);
  }

  const packMjsPath = resolve(sdkDir, 'pack.mjs');
  if (!existsSync(packMjsPath)) {
    console.error(`错误: 在 ${packMjsPath} 未找到 pack.mjs。请检查 MAPP_SDK_DIR 是否正确。`);
    process.exit(1);
  }

  const webDist = resolve(process.cwd(), 'dist-mapp/web');
  const packageDist = resolve(process.cwd(), 'dist-mapp/package');
  const appJsPath = join(webDist, 'app.js');
  const appCssPath = join(webDist, 'app.css');

  if (!existsSync(appJsPath) || !existsSync(appCssPath)) {
    console.error('错误: 未找到 dist-mapp/web/app.js 或 app.css。请先执行构建:');
    console.error('  npm run build:mapp');
    process.exit(1);
  }

  await mkdir(webDist, { recursive: true });
  await mkdir(packageDist, { recursive: true });

  // 1. 准备 manifest
  const manifestPath = resolve(process.cwd(), 'mapp/manifest.template.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (process.env.MAPP_APP_ID) {
    manifest.id = process.env.MAPP_APP_ID;
  }
  if (process.env.MAPP_VERSION) {
    manifest.version = process.env.MAPP_VERSION;
  }
  if (process.env.MAPP_WSS_URL && manifest.websockets?.game) {
    manifest.websockets.game.url = process.env.MAPP_WSS_URL;
  }

  // 2. 拷贝基础文件到 dist-mapp/web
  const templateHtml = resolve(process.cwd(), 'mapp/template.html');
  const stringsJson = resolve(process.cwd(), 'mapp/strings.json');
  await copyFile(templateHtml, join(webDist, 'index.html'));
  await copyFile(stringsJson, join(webDist, 'strings.json'));
  await writeFile(join(webDist, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // 3. 读取待打包文件
  const files = {};
  for (const name of ['index.html', 'app.js', 'app.css', 'strings.json']) {
    files[name] = await readFile(join(webDist, name));
  }

  // 4. 调用 SDK pack
  const { pack } = await import(packMjsPath);
  const result = await pack({
    manifest,
    files,
    outputDirectory: packageDist,
  });

  console.log('✓ 微应用打包成功:');
  console.log(`  产物: ${result.file}`);
  console.log(`  大小: ${result.size} 字节`);
  console.log(`  SHA-256: ${result.zipSha256}`);
  console.log(`  应用 ID: ${manifest.id}`);
  console.log(`  版本: ${manifest.version}`);
  console.log(`  WebSocket 端点: ${manifest.websockets?.game?.url}`);
}

main().catch((err) => {
  console.error('打包失败:', err);
  process.exit(1);
});
