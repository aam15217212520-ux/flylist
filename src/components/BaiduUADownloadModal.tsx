import { useState } from 'react'

interface Props {
  open: boolean
  directLink: string
  requiredUA: string
  fileName?: string
  onClose: () => void
}

/**
 * 百度网盘专用下载引导弹窗。
 *
 * 百度网盘直链要求请求方 User-Agent 精确等于 requiredUA 才会放行，否则返回 403。
 * 浏览器发起下载请求时无法自定义 User-Agent，因此无法像其他网盘一样直接点击下载，
 * 需要引导用户使用支持自定义请求头的下载工具（如 IDM）手动填入该 UA 后下载。
 */
export default function BaiduUADownloadModal({ open, directLink, requiredUA, fileName, onClose }: Props) {
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedUA, setCopiedUA] = useState(false)

  if (!open) return null

  async function copy(text: string, mark: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text)
      mark(true)
      setTimeout(() => mark(false), 1500)
    } catch {
      // 浏览器不支持或用户拒绝了剪贴板权限，静默忽略，用户仍可手动选中复制
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="max-w-lg w-full bg-panel border border-accent/30 rounded-lg shadow-glow p-6 font-mono text-sm text-slate-300 max-h-[85vh] overflow-y-auto">
        <h2 className="text-accent text-lg mb-3"># 百度网盘下载说明</h2>
        <p className="text-slate-400 mb-4 leading-relaxed">
          百度网盘的直链限制了浏览器直接下载，需要使用支持自定义请求头的下载工具（推荐 IDM）,
          手动填入下方的 User-Agent 后才能下载{fileName && `：${fileName}`}
        </p>

        <label className="block text-xs text-slate-500 mb-1">1. 下载直链</label>
        <div className="flex gap-2 mb-4">
          <input
            readOnly
            value={directLink}
            onClick={(e) => e.currentTarget.select()}
            className="flex-1 bg-black/40 border border-slate-700 rounded px-3 py-2 text-xs outline-none text-slate-200 truncate"
          />
          <button
            onClick={() => copy(directLink, setCopiedLink)}
            className="px-3 py-2 rounded bg-accent2 text-black text-xs font-bold hover:shadow-glowCyan shrink-0"
          >
            {copiedLink ? '已复制 ✓' : '复制'}
          </button>
        </div>

        <label className="block text-xs text-slate-500 mb-1">2. 自定义 User-Agent（在下载工具中填入）</label>
        <div className="flex gap-2 mb-4">
          <input
            readOnly
            value={requiredUA}
            onClick={(e) => e.currentTarget.select()}
            className="flex-1 bg-black/40 border border-slate-700 rounded px-3 py-2 text-xs outline-none text-slate-200"
          />
          <button
            onClick={() => copy(requiredUA, setCopiedUA)}
            className="px-3 py-2 rounded bg-accent2 text-black text-xs font-bold hover:shadow-glowCyan shrink-0"
          >
            {copiedUA ? '已复制 ✓' : '复制'}
          </button>
        </div>

        <div className="bg-black/30 border border-slate-700 rounded px-3 py-3 mb-4 text-xs text-slate-400 leading-relaxed space-y-1">
          <p className="text-slate-300">IDM 使用步骤：</p>
          <p>① 复制上方直链，在 IDM 中新建下载任务</p>
          <p>② 展开"选项"，找到 User-Agent（或 Headers）设置项</p>
          <p>③ 粘贴上方 User-Agent 字符串，替换默认值</p>
          <p>④ 开始下载即可</p>
          <p className="text-slate-500 pt-1">其他支持自定义请求头的下载工具（如 aria2、Motrix）用法类似。</p>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2 rounded border border-accent text-accent hover:bg-accent hover:text-black transition-colors"
        >
          关闭
        </button>
      </div>
    </div>
  )
}
