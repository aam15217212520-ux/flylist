interface Props {
  open: boolean
  onClose: () => void
}

export default function AgreementModal({ open, onClose }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="max-w-lg w-full bg-panel border border-accent/30 rounded-lg shadow-glow p-6 font-mono text-sm text-slate-300 max-h-[80vh] overflow-y-auto">
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
