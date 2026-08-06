import { useState } from 'react'
import { parseShareLink, type ParseResult } from '../lib/api'
import ResultCard from './ResultCard'

interface Props {
  onOpenAgreement: () => void
}

export default function ParseBox({ onOpenAgreement }: Props) {
  const [url, setUrl] = useState('')
  const [pwd, setPwd] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ParseResult | null>(null)

  const canSubmit = agreed && url.trim().length > 0 && !loading

  async function handleSubmit() {
    if (!canSubmit) return
    setLoading(true)
    setResult(null)
    try {
      const res = await parseShareLink(url.trim(), pwd.trim())
      setResult(res)
    } catch {
      setResult({ success: false, message: '网络异常，请稍后重试' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-panel border border-accent/20 rounded-lg p-6 shadow-glow font-mono">
      <label className="block text-xs text-slate-400 mb-1">分享链接</label>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="粘贴网盘分享链接，例如 https://xxx.lanzoui.com/xxxxx"
        className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4"
      />

      <label className="block text-xs text-slate-400 mb-1">提取码（可选）</label>
      <input
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        placeholder="提取码"
        className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4"
      />

      <label className="flex items-center gap-2 text-xs text-slate-400 mb-4 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="accent-accent w-4 h-4"
        />
        勾选则同意
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            onOpenAgreement()
          }}
          className="text-accent2 underline underline-offset-2 hover:text-accent"
        >
          FlyList 访客协议
        </button>
      </label>

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full py-2 rounded font-bold tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-accent text-black hover:shadow-glow"
      >
        {loading ? '解析中...' : '开始解析 ⚡'}
      </button>

      {result && <ResultCard result={result} />}
    </div>
  )
}
