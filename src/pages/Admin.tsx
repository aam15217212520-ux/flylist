import { useEffect, useState } from 'react'
import { fetchStats, type StatsData } from '../lib/api'

const PAN_LABELS: Record<string, string> = {
  lanzou: '蓝奏云',
  chengtong: '城通网盘',
  feiji: '小飞机网盘',
  pan123: '123云盘',
  baidu: '百度网盘',
  quark: '夸克网盘',
  gdrive: 'Google Drive',
}

interface BaiduAccountView {
  id: string
  cookieMasked: string
  note: string
  status: 'normal' | 'disabled'
  lastUsedAt: number
  createdAt: number
  lastError: string | null
}

interface ConfigData {
  baiduAccounts: BaiduAccountView[]
  quarkConfigured: boolean
  quarkUpdatedAt: number | null
  panEnabled: Record<string, boolean>
  announcement: { content: string; enabled: boolean; updatedAt: number | null }
}

export default function Admin() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [newCookie, setNewCookie] = useState('')
  const [newCookieNote, setNewCookieNote] = useState('')
  const [baiduMsg, setBaiduMsg] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCookie, setEditCookie] = useState('')
  const [editNote, setEditNote] = useState('')
  const [quarkCookie, setQuarkCookie] = useState('')
  const [quarkMsg, setQuarkMsg] = useState('')
  const [stats, setStats] = useState<StatsData | null>(null)
  const [announcementContent, setAnnouncementContent] = useState('')
  const [announcementEnabled, setAnnouncementEnabled] = useState(false)
  const [announcementMsg, setAnnouncementMsg] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [passwordMsg, setPasswordMsg] = useState('')

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

  async function handleAddBaiduAccount() {
    setBaiduMsg('')
    if (!newCookie.trim()) {
      setBaiduMsg('请输入 Cookie')
      return
    }
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addBaiduAccount: { cookie: newCookie.trim(), note: newCookieNote.trim() } }),
    })
    const json = (await res.json()) as { success: boolean; message?: string }
    setBaiduMsg(json.success ? '添加成功 ✓' : json.message ?? '添加失败')
    if (json.success) {
      setNewCookie('')
      setNewCookieNote('')
      loadConfig()
    }
  }

  async function handleRemoveBaiduAccount(id: string) {
    await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeBaiduAccountId: id }),
    })
    loadConfig()
  }

  async function handleSetBaiduAccountStatus(id: string, status: 'normal' | 'disabled') {
    await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setBaiduAccountStatus: { id, status } }),
    })
    loadConfig()
  }

  function startEditBaiduAccount(acc: BaiduAccountView) {
    setEditingId(acc.id)
    setEditCookie('')
    setEditNote(acc.note)
  }

  function cancelEditBaiduAccount() {
    setEditingId(null)
    setEditCookie('')
    setEditNote('')
  }

  async function handleSaveEditBaiduAccount(id: string) {
    await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        editBaiduAccount: {
          id,
          cookie: editCookie.trim() || undefined,
          note: editNote.trim(),
        },
      }),
    })
    cancelEditBaiduAccount()
    loadConfig()
  }

  async function handleSaveQuark() {
    setQuarkMsg('')
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quarkCookie }),
    })
    const json = (await res.json()) as { success: boolean; message?: string }
    setQuarkMsg(json.success ? '保存成功 ✓' : json.message ?? '保存失败')
    if (json.success) {
      setQuarkCookie('')
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

  async function handleChangePassword() {
    setPasswordMsg('')
    if (!oldPassword || !newPassword) {
      setPasswordMsg('请输入原密码和新密码')
      return
    }
    if (newPassword !== newPasswordConfirm) {
      setPasswordMsg('两次输入的新密码不一致')
      return
    }
    const res = await fetch('/api/admin/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword }),
    })
    const json = (await res.json()) as { success: boolean; message?: string }
    setPasswordMsg(json.success ? '密码修改成功 ✓' : json.message ?? '修改失败')
    if (json.success) {
      setOldPassword('')
      setNewPassword('')
      setNewPasswordConfirm('')
    }
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
        <h2 className="text-accent2 mb-1">百度网盘账号池</h2>
        <p className="text-xs text-slate-500 mb-4">
          共 {config?.baiduAccounts.length ?? 0} 个账号，解析时自动选用状态正常且最久未使用的账号；转存/下载失败会自动标记为失效并换用下一个账号。
        </p>

        {config && config.baiduAccounts.length > 0 && (
          <div className="space-y-2 mb-4">
            {config.baiduAccounts.map((acc) => (
              <div key={acc.id} className="bg-black/30 border border-slate-700 rounded px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs">
                    <p className="text-slate-300">
                      {acc.note ? `${acc.note} · ` : ''}
                      <span className="text-slate-500">{acc.cookieMasked}</span>
                    </p>
                    <p className="text-slate-600 mt-0.5">
                      {acc.status === 'normal' ? <span className="text-accent">正常</span> : <span className="text-warn">已失效</span>}
                      {acc.lastUsedAt > 0 && <span className="ml-2">上次使用 {new Date(acc.lastUsedAt).toLocaleString()}</span>}
                      {acc.lastError && <span className="ml-2 text-warn">{acc.lastError}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {acc.status === 'normal' ? (
                      <button
                        onClick={() => handleSetBaiduAccountStatus(acc.id, 'disabled')}
                        className="text-xs text-slate-500 hover:text-warn"
                      >
                        停用
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSetBaiduAccountStatus(acc.id, 'normal')}
                        className="text-xs text-slate-500 hover:text-accent"
                      >
                        恢复
                      </button>
                    )}
                    <button
                      onClick={() => (editingId === acc.id ? cancelEditBaiduAccount() : startEditBaiduAccount(acc))}
                      className="text-xs text-slate-500 hover:text-accent2"
                    >
                      {editingId === acc.id ? '取消' : '修改'}
                    </button>
                    <button onClick={() => handleRemoveBaiduAccount(acc.id)} className="text-xs text-slate-500 hover:text-warn">
                      删除
                    </button>
                  </div>
                </div>

                {editingId === acc.id && (
                  <div className="mt-3 pt-3 border-t border-slate-700">
                    <label className="block text-xs text-slate-400 mb-1">新 Cookie（留空则不修改，只改备注）</label>
                    <input
                      value={editCookie}
                      onChange={(e) => setEditCookie(e.target.value)}
                      placeholder="重新登录后抓取的完整 Cookie，用于替换失效账号"
                      className="w-full bg-black/40 border border-slate-700 focus:border-accent2 rounded px-3 py-2 text-sm outline-none text-slate-200 mb-2"
                    />
                    <label className="block text-xs text-slate-400 mb-1">备注</label>
                    <input
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      className="w-full bg-black/40 border border-slate-700 focus:border-accent2 rounded px-3 py-2 text-sm outline-none text-slate-200 mb-2"
                    />
                    <button
                      onClick={() => handleSaveEditBaiduAccount(acc.id)}
                      className="px-3 py-1.5 rounded bg-accent2 text-black text-xs font-bold hover:shadow-glowCyan"
                    >
                      保存修改
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <label className="block text-xs text-slate-400 mb-1">新增账号：完整 Cookie</label>
        <input
          value={newCookie}
          onChange={(e) => setNewCookie(e.target.value)}
          placeholder="从浏览器登录 pan.baidu.com 后，开发者工具里抓取完整 Cookie 请求头（包含 BAIDUID、BDUSS 等），单独 BDUSS 不够用"
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-3"
        />
        <label className="block text-xs text-slate-400 mb-1">备注（可选，方便辨认账号）</label>
        <input
          value={newCookieNote}
          onChange={(e) => setNewCookieNote(e.target.value)}
          placeholder="例如：账号1 / SVIP7"
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4"
        />
        <button onClick={handleAddBaiduAccount} className="px-4 py-2 rounded bg-accent2 text-black font-bold hover:shadow-glowCyan">
          添加账号
        </button>
        {baiduMsg && <span className="ml-3 text-xs text-slate-400">{baiduMsg}</span>}
      </section>

      <section className="bg-panel border border-accent/20 rounded-lg p-6 mb-6">
        <h2 className="text-accent2 mb-1">夸克网盘账号配置</h2>
        <p className="text-xs text-slate-500 mb-4">
          当前状态：
          {config?.quarkConfigured ? <span className="text-accent"> 已配置 ✓</span> : <span className="text-warn"> 未配置</span>}
          {config?.quarkUpdatedAt && (
            <span className="ml-2 text-slate-600">更新于 {new Date(config.quarkUpdatedAt).toLocaleString()}</span>
          )}
        </p>
        <label className="block text-xs text-slate-400 mb-1">Cookie（从浏览器登录 pan.quark.cn 后抓取完整 Cookie 字符串）</label>
        <input
          value={quarkCookie}
          onChange={(e) => setQuarkCookie(e.target.value)}
          placeholder="留空则不修改"
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4"
        />
        <button onClick={handleSaveQuark} className="px-4 py-2 rounded bg-accent2 text-black font-bold hover:shadow-glowCyan">
          保存
        </button>
        {quarkMsg && <span className="ml-3 text-xs text-slate-400">{quarkMsg}</span>}
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

      <section className="bg-panel border border-accent/20 rounded-lg p-6 mt-6">
        <h2 className="text-accent2 mb-4">修改管理密码</h2>
        <label className="block text-xs text-slate-400 mb-1">原密码</label>
        <input
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-3"
        />
        <label className="block text-xs text-slate-400 mb-1">新密码（至少 6 位）</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-3"
        />
        <label className="block text-xs text-slate-400 mb-1">确认新密码</label>
        <input
          type="password"
          value={newPasswordConfirm}
          onChange={(e) => setNewPasswordConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleChangePassword()}
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4"
        />
        <button onClick={handleChangePassword} className="px-4 py-2 rounded bg-accent2 text-black font-bold hover:shadow-glowCyan">
          修改密码
        </button>
        {passwordMsg && <span className="ml-3 text-xs text-slate-400">{passwordMsg}</span>}
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
