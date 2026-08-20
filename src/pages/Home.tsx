import { useState } from 'react'
import ParseBox from '../components/ParseBox'
import AgreementModal from '../components/AgreementModal'
import Announcement from '../components/Announcement'

const SUPPORTED_PANS = [
  { key: 'lanzou', name: '蓝奏云' },
  { key: 'ilanzou', name: '蓝奏云优享版' },
  { key: 'chengtong', name: '城通网盘' },
  { key: 'feiji', name: '小飞机网盘' },
  { key: 'pan123', name: '123云盘' },
  { key: 'baidu', name: '百度网盘 · SVIP加速' },
  { key: 'quark', name: '夸克网盘' },
  { key: 'gdrive', name: 'Google Drive' },
]

export default function Home() {
  const [agreementOpen, setAgreementOpen] = useState(false)

  return (
    <div className="scanline min-h-screen flex flex-col items-center px-4 py-16">
      <header className="text-center mb-10">
        <h1 className="text-5xl font-mono font-bold font-mono-glow text-accent tracking-widest">
          FlyList<span className="text-accent2">_</span>
        </h1>
        <p className="mt-3 text-slate-400 font-mono text-sm">$ 聚合网盘直链解析工具 · 粘贴分享链接即可高速下载</p>
      </header>

      <Announcement />

      <div className="w-full max-w-2xl">
        <ParseBox onOpenAgreement={() => setAgreementOpen(true)} />
      </div>

      <div className="flex flex-wrap gap-2 justify-center mt-10 max-w-2xl">
        {SUPPORTED_PANS.map((pan) => (
          <span
            key={pan.key}
            className="px-3 py-1 rounded-full border border-accent/30 bg-panel text-xs font-mono text-accent/90"
          >
            {pan.name}
          </span>
        ))}
      </div>

      <footer className="mt-16 text-center text-xs text-slate-500 font-mono space-y-1">
        <p>
          使用本站即代表您同意{' '}
          <button
            onClick={() => setAgreementOpen(true)}
            className="text-accent2 underline underline-offset-2 hover:text-accent"
          >
            《FlyList 访客协议》
          </button>
        </p>
        <p>本站不存储任何文件，所有直链均来自网盘官方接口临时授权 · 仅供学习交流</p>
        <p className="pt-2">
          <a href="/admin" className="hover:text-accent2">
            管理后台 →
          </a>
        </p>
      </footer>

      <AgreementModal open={agreementOpen} onClose={() => setAgreementOpen(false)} />
    </div>
  )
}
