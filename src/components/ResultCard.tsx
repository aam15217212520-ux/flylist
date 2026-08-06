import type { ParseResult } from '../lib/api'

export default function ResultCard({ result }: { result: ParseResult }) {
  if (!result.success || !result.data) {
    return (
      <div className="mt-4 border border-warn/40 bg-warn/10 text-warn text-sm rounded px-3 py-2 space-y-2">
        <p>✕ {result.message ?? '解析失败'}</p>
        {result.fallbackUrl && (
          <a
            href={result.fallbackUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block px-3 py-1.5 rounded bg-warn/20 border border-warn/50 text-warn text-xs font-bold hover:bg-warn/30"
          >
            在新标签页打开原始链接自行下载 ↗
          </a>
        )}
      </div>
    )
  }

  const { panName, fileName, fileSize, directLink, cacheHit } = result.data

  return (
    <div className="mt-4 border border-accent/30 bg-black/30 rounded px-4 py-3 text-sm space-y-2">
      <p className="text-accent">
        ✓ {panName} 解析成功 {cacheHit && <span className="text-slate-500 text-xs">(缓存命中)</span>}
      </p>
      {fileName && <p className="text-slate-300 truncate">文件名：{fileName}</p>}
      {fileSize && <p className="text-slate-500 text-xs">大小：{fileSize}</p>}
      <a
        href={directLink}
        target="_blank"
        rel="noreferrer"
        className="inline-block mt-2 px-4 py-1.5 rounded bg-accent2 text-black font-bold hover:shadow-glowCyan"
      >
        立即下载 ↓
      </a>
    </div>
  )
}
