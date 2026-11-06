// 访问统计（umami）：脚本地址与各站点的 website-id 全部来自构建时环境变量，仓库里不存任何站点 ID。
// 配置放在 frontend/.env.local（已被 .gitignore 忽略），格式见 .env.example；没配置就什么都不做。
// 之所以不写进 index.html：部署流程会 stash / pop 对该文件的本地修改，需求一改 <head> 就冲突（AISLG-235）。

/** 解析「页面域名 → website-id」映射；格式不对时忽略并告警 */
function idByHost(): Record<string, string> {
  const raw = import.meta.env.PUBLIC_UMAMI_BY_HOST;
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    console.warn('PUBLIC_UMAMI_BY_HOST 不是合法 JSON，已忽略');
    return {};
  }
}

/** 启动时调用（main.tsx）：当前域名在映射里才加载统计脚本，本地开发和内网域名不上报 */
export function initAnalytics(): void {
  const src = import.meta.env.PUBLIC_UMAMI_SCRIPT;
  const websiteId = idByHost()[location.hostname];
  if (!src || !websiteId) {
    return;
  }
  const script = document.createElement('script');
  script.defer = true;
  script.src = src;
  script.setAttribute('data-website-id', websiteId);
  document.head.appendChild(script);
}
