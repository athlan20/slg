/** 允许 `import './styles/index.css'` 这类副作用导入；样式由 Rsbuild 处理。 */
declare module '*.css';

/** Rsbuild 在构建时注入的 PUBLIC_ 前缀环境变量（读取 frontend/.env、.env.local 等）。 */
interface ImportMetaEnv {
  /** 额外的站点 → WebSocket 网关映射（JSON），见 api/client.ts */
  readonly PUBLIC_WS_BY_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
