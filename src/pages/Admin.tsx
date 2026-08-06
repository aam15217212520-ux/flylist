import { useEffect, useState } from 'react'
import { fetchStats, type StatsData } from '../lib/api'

const PAN_LABELS: Record<string, string> = {
  lanzou: '蓝奏云',
  chengtong: '城通网盘',
  feiji: '小飞机网盘',
  pan123: '123云盘',
  baidu: '百度网盘',
}

interface ConfigData {
  baiduConfigured: boolean
  baiduUpdatedAt: number | null
  panEnabled: Record<string, boolean>
  announcement: { content: string; enabled: boolean; updatedAt: number | null }
}

export default function Admin() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [bduss, setBduss] = useState('')
  const [stoken, setStoken] = useState('')
  const [stats, setStats] = useState<StatsData | null>(null)
  const [saveMsg, setSaveMsg] = useState('')
  const [announcementContent, setAnnouncementContent] = useState('')
  const [announcementEnabled, setAnnouncementEnabled] = useState(false)
  const [announcementMsg, setAnnouncementMsg] = useState('')

  async function loadConfig() {
    const res = await fetch('/api/admin/config')
    if (res.status === 401) {
      setAuthed(false)
      return
    }
    const json = (await res.json()) as { success: boolean; data?: ConfigData }
    if (json.success && json.data) {
      setAuthed(true)
      setConfig(json.data)
      setAnnouncementContent(json.data.announcement.content)
      setAnnouncementEnabled(json.data.announcement.enabled)
    }
  }

  useEffect(() => {
    loadConfig()
    fetchStats().then((res) => res.success && setStats(res.data ?? null))
  }, [])

  async function handleLogin() {
    setLoginError('')
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    const json = (await res.json()) as { success: boolean; message?: string }
    if (json.success) {
      await loadConfig()
    } else {
      setLoginError(json.message ?? '登录失败')
    }
  }

  async function handleSaveBaidu() {
    setSaveMsg('')
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bduss, stoken }),
    })
    const json = (await res.json()) as { success: boolean; message?: string }
    setSaveMsg(json.success ? '保存成功 ✓' : json.message ?? '保存失败')
    if (json.success) {
      setBduss('')
      setStoken('')
      loadConfig()
    }
  }

  async function handleSaveAnnouncement() {
    setAnnouncementMsg('')
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ announcement: { content: announcementContent, enabled: announcementEnabled } }),
    })
    const json = (await res.json()) as { success: boolean; message?: string }
    setAnnouncementMsg(json.success ? '保存成功 ✓' : json.message ?? '保存失败')
    if (json.success) loadConfig()
  }

  async function togglePan(pan: string, enabled: boolean) {
    if (!config) return
    const nextEnabled = { ...config.panEnabled, [pan]: enabled }
    setConfig({ ...config, panEnabled: nextEnabled })
    await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panEnabled: { [pan]: enabled } }),
    })
  }

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    setAuthed(false)
    setConfig(null)
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-panel border border-accent/20 rounded-lg p-8 w-full max-w-sm font-mono shadow-glow">
          <h1 className="text-accent text-xl mb-6"># FlyList 管理后台</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="管理密码（首次输入即设置为初始密码）"
            className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4"
          />
          {loginError && <p className="text-warn text-xs mb-3">{loginError}</p>}
          <button onClick={handleLogin} className="w-full py-2 rounded bg-accent text-black font-bold hover:shadow-glow">
            登录
          </button>
          <a href="/" className="block text-center text-xs text-slate-500 mt-4 hover:text-accent2">
            ← 返回首页
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-10 max-w-3xl mx-auto font-mono">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-accent text-2xl"># FlyList 管理后台</h1>
        <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-warn">
          退出登录
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-8">
          <StatCard label="累计解析" value={stats.total} />
          <StatCard label="今日解析" value={stats.today} />
          <StatCard label="缓存网盘数" value={Object.keys(stats.byPan).length} />
        </div>
      )}

      <section className="bg-panel border border-accent/20 rounded-lg p-6 mb-6">
        <h2 className="text-accent2 mb-1">百度网盘 SVIP 账号配置</h2>
        <p className="text-xs text-slate-500 mb-4">
          当前状态：
          {config?.baiduConfigured ? <span className="text-accent"> 已配置 ✓</span> : <span className="text-warn"> 未配置</span>}
          {config?.baiduUpdatedAt && (
            <span className="ml-2 text-slate-600">更新于 {new Date(config.baiduUpdatedAt).toLocaleString()}</span>
          )}
        </p>
        <label className="block text-xs text-slate-400 mb-1">BDUSS</label>
        <input
          value={bduss}
          onChange={(e) => setBduss(e.target.value)}
          placeholder="留空则不修改"
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-3"
        />
        <label className="block text-xs text-slate-400 mb-1">STOKEN</label>
        <input
          value={stoken}
          onChange={(e) => setStoken(e.target.value)}
          placeholder="留空则不修改"
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4"
        />
        <button onClick={handleSaveBaidu} className="px-4 py-2 rounded bg-accent2 text-black font-bold hover:shadow-glowCyan">
          保存
        </button>
        {saveMsg && <span className="ml-3 text-xs text-slate-400">{saveMsg}</span>}
      </section>

      <section className="bg-panel border border-accent/20 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-accent2">公告栏管理</h2>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            启用
            <input
              type="checkbox"
              checked={announcementEnabled}
              onChange={(e) => setAnnouncementEnabled(e.target.checked)}
              className="accent-accent2 w-4 h-4"
            />
          </label>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          启用后，访客打开首页会弹窗显示这段内容（除非当天已经关闭过），关闭后会在标题下方保留一行常驻提示。
          {config?.announcement.updatedAt && (
            <span className="ml-2 text-slate-600">更新于 {new Date(config.announcement.updatedAt).toLocaleString()}</span>
          )}
        </p>
        <textarea
          value={announcementContent}
          onChange={(e) => setAnnouncementContent(e.target.value)}
          placeholder="填入公告内容，支持换行"
          rows={4}
          className="w-full bg-black/40 border border-slate-700 focus:border-accent2 rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4 resize-y"
        />
        <button
          onClick={handleSaveAnnouncement}
          className="px-4 py-2 rounded bg-accent2 text-black font-bold hover:shadow-glowCyan"
        >
          保存
        </button>
        {announcementMsg && <span className="ml-3 text-xs text-slate-400">{announcementMsg}</span>}
      </section>

      <section className="bg-panel border border-accent/20 rounded-lg p-6">
        <h2 className="text-accent2 mb-4">网盘解析开关</h2>
        <div className="space-y-3">
          {Object.entries(PAN_LABELS).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between text-sm">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={config?.panEnabled[key] ?? true}
                onChange={(e) => togglePan(key, e.target.checked)}
                className="accent-accent w-4 h-4"
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-panel border border-accent/20 rounded-lg p-4 text-center">
      <p className="text-2xl text-accent font-bold">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  )
}
