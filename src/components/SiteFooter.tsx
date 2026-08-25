import { useState } from 'react'

type ModalKind = 'agreement' | 'privacy' | null

export default function Footer() {
  const [modal, setModal] = useState<ModalKind>(null)

  return (
    <footer className="mt-16 text-center text-xs text-slate-500 font-mono space-y-1">
      <p>本站遵循免费公益交流学习，从未用于商业用途</p>
      <p>© KeLe Studio &amp; FlyAi Studio</p>
      <p className="flex items-center justify-center gap-4 pt-2 text-sm">
        <button onClick={() => setModal('agreement')} className="text-slate-400 hover:text-accent2 transition-colors">
          服务条款
        </button>
        <button onClick={() => setModal('privacy')} className="text-slate-400 hover:text-accent2 transition-colors">
          隐私政策
        </button>
        <a
          href="https://qm.qq.com/q/vIT1oa4aZi"
          target="_blank"
          rel="noreferrer"
          className="text-slate-400 hover:text-accent2 transition-colors"
        >
          联系我们
        </a>
      </p>
      <p className="pt-2">
        <a href="/admin" className="hover:text-accent2">
          管理后台 →
        </a>
      </p>

      {modal === 'agreement' && <AgreementModal onClose={() => setModal(null)} />}
      {modal === 'privacy' && <PrivacyModal onClose={() => setModal(null)} />}
    </footer>
  )
}

function AgreementModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div
        className="max-w-lg w-full bg-panel border border-accent/30 rounded-lg shadow-glow p-6 font-mono text-sm text-slate-300 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-accent text-lg mb-4"># FlyList 访客协议</h2>
        <ol className="list-decimal list-inside space-y-3 leading-relaxed">
          <li>本站（FlyList）是一个技术学习性质的网盘分享链接解析工具，仅用于个人学习、技术研究与合法合规的文件中转用途。</li>
          <li>本站不存储、不上传、不生成任何用户文件，所有解析结果均来自各网盘官方分享接口返回的临时直链，本站仅作转发展示。</li>
          <li>访客通过本站解析、下载的任何内容，其来源、合法性、版权归属均由分享者与访客自行负责，本站不对内容的合法性、准确性、完整性作任何担保。</li>
          <li>
            若您使用到站长配置的第三方网盘会员权益进行加速下载，请勿滥用、批量抓取或用于商业用途，因滥用导致相关账号被限速、冻结或封禁的后果由使用者自行承担。
          </li>
          <li>请勿使用本站下载、传播侵犯他人知识产权、隐私或违反当地法律法规的内容。如涉及侵权，请联系原分享方或相关平台处理。</li>
          <li>本站保留在不事先通知的情况下修改、中断或终止服务的权利。</li>
          <li>继续使用本站即代表您已阅读、理解并同意以上全部条款。</li>
        </ol>
        <button
          onClick={onClose}
          className="mt-6 w-full py-2 rounded border border-accent text-accent hover:bg-accent hover:text-black transition-colors"
        >
          关闭
        </button>
      </div>
    </div>
  )
}

function PrivacyModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div
        className="max-w-lg w-full bg-panel border border-accent/30 rounded-lg shadow-glow p-6 font-mono text-sm text-slate-300 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-accent text-lg mb-1"># FlyList 隐私政策</h2>
        <p className="text-slate-500 text-xs mb-4">生效日期：2026 年 8 月 25 日</p>
        <div className="space-y-4 leading-relaxed">
          <section>
            <p>
              FlyList（下称「本站」）非常重视您的隐私。本隐私政策说明我们在您使用本站时处理哪些信息、如何处理这些信息，以及您拥有哪些选择与权利。请您在使用本站前仔细阅读本政策。
            </p>
          </section>
          <section>
            <h3 className="text-accent2 mb-1">我们收集的信息</h3>
            <p>本站不要求注册账号，不收集姓名、电话号码、电子邮箱等个人身份信息。当您使用本站时，我们会处理以下信息：</p>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li><strong className="text-slate-200">您提交的内容</strong>：您粘贴的网盘分享链接及提取码。这些内容仅用于向您提供解析服务；</li>
              <li><strong className="text-slate-200">设备与网络信息</strong>：IP 地址、浏览器 User-Agent 等由网络连接自动产生的技术信息，用于安全防护、访问频率限制与滥用排查；</li>
              <li><strong className="text-slate-200">使用记录</strong>：解析请求的时间、目标文件名、文件大小等，用于统计与故障排查。</li>
            </ul>
          </section>
          <section>
            <h3 className="text-accent2 mb-1">我们如何使用信息</h3>
            <p>我们使用上述信息仅限于：提供并改进链接解析与下载服务、防止接口被自动化脚本滥用、排查服务故障、进行匿名化的访问量统计。我们不会将您的信息用于广告投放、用户画像或任何商业营销目的。</p>
          </section>
          <section>
            <h3 className="text-accent2 mb-1">追踪与广告</h3>
            <p>本站不使用跨站跟踪技术，不接入任何第三方统计、分析或广告 SDK。您在本站的活动不会被用于构建广告画像。</p>
          </section>
          <section>
            <h3 className="text-accent2 mb-1">Cookie 与本地存储</h3>
            <p>本站仅在必要范围内使用浏览器本地存储保存站点设置（例如「已同意访客协议」的标记），不使用跟踪型 Cookie。您可以随时通过浏览器设置清除这些数据。</p>
          </section>
          <section>
            <h3 className="text-accent2 mb-1">信息的共享</h3>
            <p>除以下情形外，我们不会向任何第三方提供您的信息：</p>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>为完成解析功能，您提交的分享链接会被发送至对应网盘的官方接口；</li>
              <li>为提供基础网络服务，部分技术数据由我们的基础设施服务提供商（Cloudflare）处理；</li>
              <li>依据法律法规或有权机关的强制性要求；</li>
              <li>为维护本站、其他用户或公众的安全与合法权益所合理必需。</li>
            </ul>
          </section>
          <section>
            <h3 className="text-accent2 mb-1">信息的保留与安全</h3>
            <p>解析记录与日志存储于加密传输（HTTPS）的安全环境中，并设置合理的保存期限，到期或不再必要时即删除。我们采取业界通行的技术与管理措施，防止信息被未经授权访问、泄露、篡改或损毁。</p>
          </section>
          <section>
            <h3 className="text-accent2 mb-1">您的权利</h3>
            <p>您可以通过停止使用本站随时终止数据的进一步收集；也可以通过浏览器设置清除与本站相关的本地存储数据。如需查询、更正或删除与您相关的解析记录，可通过页面底部的「联系我们」与我们取得联系。</p>
          </section>
          <section>
            <h3 className="text-accent2 mb-1">未成年人保护</h3>
            <p>本站面向一般用户，不面向未满 14 周岁的未成年人提供服务。如我们发现误收集了未成年人的个人信息，将尽快删除。</p>
          </section>
          <section>
            <h3 className="text-accent2 mb-1">政策的更新</h3>
            <p>本政策可能不时更新，更新后将在本页面发布并标注生效日期。重大变更时我们会以显著方式提示。继续使用本站即表示您已阅读并同意更新后的隐私政策。</p>
          </section>
        </div>
        <button
          onClick={onClose}
          className="mt-6 w-full py-2 rounded border border-accent text-accent hover:bg-accent hover:text-black transition-colors"
        >
          关闭
        </button>
      </div>
    </div>
  )
}
