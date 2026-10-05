import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss';
import { prototypesPreview } from './tools/prototypes-preview';

export default defineConfig({
  plugins: [pluginReact(), pluginTailwindcss()],
  html: {
    template: './index.html',
  },
  source: {
    entry: { index: './src/main.tsx' },
  },
  server: {
    port: 8424,
    setup: prototypesPreview,
  },
  output: {
    distPath: { root: 'dist' },
  },
});
