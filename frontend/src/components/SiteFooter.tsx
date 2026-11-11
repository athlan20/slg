import { useCopy } from '../i18n/bundle';

// 登录页页脚（AISLG-252）：Creem 审核要在官网直接看到隐私政策、服务条款、定价与客服邮箱，
// 所以未登录首页最底部固定给出这四项。法务页面是静态 HTML（src/legal/），这里只做入口。
//
// 客服邮箱不写死在仓库里（项目开源）：从构建期环境变量 PUBLIC_SUPPORT_EMAIL 读（frontend/.env.local
// 或部署环境注入），没配置时整个邮箱项不显示，其余三项照常。

/** 构建期注入的客服邮箱；Rsbuild 的 PUBLIC_ 前缀变量会替换成字面量 */
const SUPPORT_EMAIL = (import.meta.env.PUBLIC_SUPPORT_EMAIL ?? '').trim();

const linkClass = 'underline-offset-2 hover:text-accent hover:underline';

export function SiteFooter() {
  const { LEGAL_COPY } = useCopy();

  return (
    <footer role="site-footer" className="mt-4 border-t border-line-soft pt-3 text-[12px] text-faint">
      <nav
        role="site-footer-链接"
        aria-label={LEGAL_COPY.footerLabel}
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
      >
        <a role="site-footer-隐私政策" href="/privacy.html" className={linkClass}>
          {LEGAL_COPY.privacy}
        </a>
        <a role="site-footer-服务条款" href="/terms.html" className={linkClass}>
          {LEGAL_COPY.terms}
        </a>
        <a role="site-footer-定价" href="/pricing.html" className={linkClass}>
          {LEGAL_COPY.pricing}
        </a>
        {SUPPORT_EMAIL ? (
          <a role="site-footer-客服邮箱" href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
            {LEGAL_COPY.support}
          </a>
        ) : null}
      </nav>
      <p role="site-footer-价格说明" className="mt-1">
        {LEGAL_COPY.priceNote}
      </p>
    </footer>
  );
}
