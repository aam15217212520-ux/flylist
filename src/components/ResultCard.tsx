import type { ParseResult } from '../lib/api'

interface Props {
  result: ParseResult
  onSelectFolderFile?: (url: string) => void
}

export default function ResultCard({ result, onSelectFolderFile }: Props) {
  if (!result.success || !result.data) {
    if (result.isFolder && result.folder) {
      const { panName, folderName, files } = result.folder
      return (
        <div className="mt-4 border border-accent/30 bg-black/30 rounded px-4 py-3 text-sm space-y-2">
          <p className="text-accent">
            ✓ {panName} 识别为文件夹分享{folderName && `：${folderName}`}，请选择要下载的文件
          </p>
          <ul className="divide-y divide-slate-700/50">
            {files.map((f) => (
              <li key={f.fileId} className="flex items-center justify-between py-2 gap-3">
                <span className="text-slate-300 truncate">{f.fileName}</span>
                <div className="flex items-center gap-3 shrink-0">
                  {f.fileSize && <span className="text-slate-500 text-xs">{f.fileSize}</span>}
                  <button
                    onClick={() => onSelectFolderFile?.(f.url)}
                    className="px-3 py-1 rounded bg-accent2 text-black text-xs font-bold hover:shadow-glowCyan"
                  >
                    解析下载
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )
    }

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
