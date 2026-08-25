import { useState } from 'react'

interface Props {
  open: boolean
  fileName?: string
  directLink: string
  ua: string
  onClose: () => void
}

/** 百度网盘专用下载弹窗：百度 CDN 直链校验 User-Agent，浏览器直接点会 403，
 * 需要用 IDM 等下载工具并手动填入 UA。这里把直链和 UA 都给出来，方便复制。 */
export default function BaiduDownloadModal({ open, fileName, directLink, ua, onClose }: Props) {
  const [copied, setCopied] = useState<'link' | 'ua' | null>(null)

  if (!open) return null

  async function copy(text: string, which: 'link' | 'ua') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // 剪贴板不可用时退化为选中文本
      const el = document.getElementById(which === 'link' ? 'baidu-dl-link' : 'baidu-dl-ua')
      if (el) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div
        className="bg-panel border border-accent/40 rounded-lg max-w-xl w-full p-6 space-y-4 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-accent font-bold">百度网盘 · 需要下载工具</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">
            ✕
          </button>
        </div>

        <p className="text-slate-400 text-xs leading-relaxed">
          百度网盘的下载链接校验 User-Agent，浏览器直接打开会返回 403。请用 IDM、FDM、Motrix 等下载工具，
          按下面两步配置后新建下载任务，即可满速下载。还没装 IDM？
          <a
            href="https://www.uy5.net/idm/"
            target="_blank"
            rel="noreferrer"
            className="text-accent2 hover:underline"
          >
            点此下载 IDM
          </a>
          。
        </p>

        {fileName && <p className="text-slate-300 truncate">文件：{fileName}</p>}

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">第 1 步：复制下载链接</span>
            <button
              onClick={() => copy(directLink, 'link')}
              className="px-2 py-0.5 rounded border border-accent/40 text-xs text-accent hover:bg-accent/10"
            >
              {copied === 'link' ? '已复制 ✓' : '复制'}
            </button>
          </div>
          <code
            id="baidu-dl-link"
            className="block bg-black/60 border border-slate-800 rounded px-2 py-1.5 text-[11px] text-accent2 font-mono break-all select-all max-h-24 overflow-y-auto"
          >
            {directLink}
          </code>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">第 2 步：在下载工具的 UA 设置中填入以下内容</span>
            <button
              onClick={() => copy(ua, 'ua')}
              className="px-2 py-0.5 rounded border border-accent/40 text-xs text-accent hover:bg-accent/10"
            >
              {copied === 'ua' ? '已复制 ✓' : '复制'}
            </button>
          </div>
          <code
            id="baidu-dl-ua"
            className="block bg-black/60 border border-slate-800 rounded px-2 py-1.5 text-[11px] text-accent2 font-mono break-all select-all"
          >
            {ua}
          </code>
          <p className="text-[11px] text-slate-500 mt-1.5">
            IDM：选项 → 连接 → 代理服务器 → 「用户代理」字段（或新建任务时在「设置」里填）。
            FDM/Motrix：下载设置里的「User-Agent」字段。
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <a
            href={directLink}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-1.5 rounded bg-accent2 text-black font-bold hover:shadow-glowCyan"
          >
            浏览器直接下载（可能 403）
          </a>
          <button onClick={onClose} className="px-4 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/30">
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
