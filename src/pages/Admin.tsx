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
  ilanzou: '蓝奏云优享版',
  aliyun: '阿里云盘',
  cloud189: '天翼云盘',
  uc: 'UC 网盘',
  xunlei: '迅雷网盘',
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
  ucConfigured: boolean
  ucUpdatedAt: number | null
  aliyunConfigured: boolean
  aliyunUpdatedAt: number | null
  xunleiConfigured: boolean
  xunleiUpdatedAt: number | null
  cloud189Configured: boolean
  cloud189UpdatedAt: number | null
  panEnabled: Record<string, boolean>
  panDisabledReasons: Record<string, string>
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
  const [aliyunRefreshToken, setAliyunRefreshToken] = useState('')
  const [aliyunMsg, setAliyunMsg] = useState('')
  const [cloud189CookieLoginUser, setCloud189CookieLoginUser] = useState('')
  const [cloud189Sson, setCloud189Sson] = useState('')
  const [cloud189Msg, setCloud189Msg] = useState('')
  const [ucCookie, setUcCookie] = useState('')
  const [ucMsg, setUcMsg] = useState('')
  const [xunleiRefreshToken, setXunleiRefreshToken] = useState('')
  const [xunleiMsg, setXunleiMsg] = useState('')
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

  async function handleSaveAliyun() {
    setAliyunMsg('')
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliyunRefreshToken }),
    })
    const json = (await res.json()) as { success: boolean; message?: string }
    setAliyunMsg(json.success ? '保存成功 ✓' : json.message ?? '保存失败')
    if (json.success) {
      setAliyunRefreshToken('')
      loadConfig()
    }
  }

  async function handleSaveCloud189() {
    setCloud189Msg('')
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloud189CookieLoginUser, cloud189Sson }),
    })
    const json = (await res.json()) as { success: boolean; message?: string }
    setCloud189Msg(json.success ? '保存成功 ✓' : json.message ?? '保存失败')
    if (json.success) {
      setCloud189CookieLoginUser('')
      setCloud189Sson('')
      loadConfig()
    }
  }

  async function handleSaveUc() {
    setUcMsg('')
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ucCookie }),
    })
    const json = (await res.json()) as { success: boolean; message?: string }
    setUcMsg(json.success ? '保存成功 ✓' : json.message ?? '保存失败')
    if (json.success) {
      setUcCookie('')
      loadConfig()
    }
  }

  async function handleSaveXunlei() {
    setXunleiMsg('')
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xunleiRefreshToken }),
    })
    const json = (await res.json()) as { success: boolean; message?: string }
    setXunleiMsg(json.success ? '保存成功 ✓' : json.message ?? '保存失败')
    if (json.success) {
      setXunleiRefreshToken('')
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

  async function savePanDisabledReason(pan: string, reason: string) {
    if (!config) return
    const nextReasons = { ...config.panDisabledReasons, [pan]: reason }
    setConfig({ ...config, panDisabledReasons: nextReasons })
    await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panDisabledReasons: { [pan]: reason } }),
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
        <h2 className="text-accent2 mb-1">UC 网盘账号配置</h2>
        <p className="text-xs text-slate-500 mb-4">
          当前状态：
          {config?.ucConfigured ? <span className="text-accent"> 已配置 ✓</span> : <span className="text-warn"> 未配置</span>}
          {config?.ucUpdatedAt && (
            <span className="ml-2 text-slate-600">更新于 {new Date(config.ucUpdatedAt).toLocaleString()}</span>
          )}
        </p>
        <p className="text-xs text-slate-500 mb-3">
          架构与夸克网盘完全一致（阿里系 quark_uc 同源）。下载直链的签名绑定签发时的 Cookie 与 IP，
          因此解析只返回令牌，访客点击下载时才现场签发并代理取流。
        </p>
        <p className="text-xs text-warn/80 mb-3">
          粘贴时不要带 <code className="text-slate-300">uc:</code> 之类的前缀标签，否则所有请求会返回 500（code 15000）。
        </p>
        <label className="block text-xs text-slate-400 mb-1">Cookie（登录 drive.uc.cn 后按 F12 → Network → 任选一个请求 → 复制完整 Cookie 请求头）</label>
        <input
          value={ucCookie}
          onChange={(e) => setUcCookie(e.target.value)}
          placeholder="留空则不修改"
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4"
        />
        <button onClick={handleSaveUc} className="px-4 py-2 rounded bg-accent2 text-black font-bold hover:shadow-glowCyan">
          保存
        </button>
        {ucMsg && <span className="ml-3 text-xs text-slate-400">{ucMsg}</span>}
      </section>

      <section className="bg-panel border border-accent/20 rounded-lg p-6 mb-6">
        <h2 className="text-accent2 mb-1">阿里云盘账号配置</h2>
        <p className="text-xs text-slate-500 mb-4">
          当前状态：
          {config?.aliyunConfigured ? <span className="text-accent"> 已配置 ✓</span> : <span className="text-warn"> 未配置</span>}
          {config?.aliyunUpdatedAt && (
            <span className="ml-2 text-slate-600">更新于 {new Date(config.aliyunUpdatedAt).toLocaleString()}</span>
          )}
        </p>
        <p className="text-xs text-slate-500 mb-3">
          解析时会把分享文件转存到该账号的网盘再取直链，下载完成后会自动删除转存文件，不会长期占用网盘容量。
        </p>
        <label className="block text-xs text-slate-400 mb-1">Refresh Token（从浏览器登录 alipan.com 后，在 Local Storage 里查找带 token 字样的项获取）</label>
        <input
          value={aliyunRefreshToken}
          onChange={(e) => setAliyunRefreshToken(e.target.value)}
          placeholder="留空则不修改"
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4"
        />
        <button onClick={handleSaveAliyun} className="px-4 py-2 rounded bg-accent2 text-black font-bold hover:shadow-glowCyan">
          保存
        </button>
        {aliyunMsg && <span className="ml-3 text-xs text-slate-400">{aliyunMsg}</span>}
      </section>

      <section className="bg-panel border border-accent/20 rounded-lg p-6 mb-6">
        <h2 className="text-accent2 mb-1">迅雷网盘账号配置</h2>
        <p className="text-xs text-slate-500 mb-4">
          当前状态：
          {config?.xunleiConfigured ? <span className="text-accent"> 已配置 ✓</span> : <span className="text-warn"> 未配置</span>}
          {config?.xunleiUpdatedAt && (
            <span className="ml-2 text-slate-600">更新于 {new Date(config.xunleiUpdatedAt).toLocaleString()}</span>
          )}
        </p>
        <p className="text-xs text-slate-500 mb-3">
          解析时会把分享文件转存到该账号的网盘再取直链，访客开始下载后自动删除转存文件，不会长期占用容量。
          若分享本身就是该账号发出的，则跳过转存直接签发直链，也不会删除你自己的文件。
        </p>
        <p className="text-xs text-warn/80 mb-3">
          迅雷每次刷新都会轮换 refresh token 并立即作废旧值。请填入<b>最新</b>的一个；
          同时用浏览器登录迅雷网页版会与本站争抢同一条 token 链，导致解析间歇失效。
        </p>
        <label className="block text-xs text-slate-400 mb-1">
          Refresh Token（登录 pan.xunlei.com 后按 F12 → Application → Local Storage → 展开 <code className="text-slate-300">credentials_Xqp0kJBXWhwaTpB6</code> → 取其中的 refresh_token 字段）
        </label>
        <input
          value={xunleiRefreshToken}
          onChange={(e) => setXunleiRefreshToken(e.target.value)}
          placeholder="留空则不修改"
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4"
        />
        <button onClick={handleSaveXunlei} className="px-4 py-2 rounded bg-accent2 text-black font-bold hover:shadow-glowCyan">
          保存
        </button>
        {xunleiMsg && <span className="ml-3 text-xs text-slate-400">{xunleiMsg}</span>}
      </section>

      <section className="bg-panel border border-accent/20 rounded-lg p-6 mb-6">
        <h2 className="text-accent2 mb-1">天翼云盘账号配置</h2>
        <p className="text-xs text-slate-500 mb-4">
          当前状态：
          {config?.cloud189Configured ? <span className="text-accent"> 已配置 ✓</span> : <span className="text-warn"> 未配置</span>}
          {config?.cloud189UpdatedAt && (
            <span className="ml-2 text-slate-600">更新于 {new Date(config.cloud189UpdatedAt).toLocaleString()}</span>
          )}
        </p>
        <p className="text-xs text-slate-500 mb-3">
          登录 cloud.189.cn 后，F12 → 应用程序/Application → Cookies → 找到名字正好叫 COOKIE_LOGIN_USER 的那一项，复制它的值。如果旁边还有个叫 SSON 的项，也一并复制。
        </p>
        <label className="block text-xs text-slate-400 mb-1">COOKIE_LOGIN_USER</label>
        <input
          value={cloud189CookieLoginUser}
          onChange={(e) => setCloud189CookieLoginUser(e.target.value)}
          placeholder="留空则不修改"
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4"
        />
        <label className="block text-xs text-slate-400 mb-1">SSON（可选）</label>
        <input
          value={cloud189Sson}
          onChange={(e) => setCloud189Sson(e.target.value)}
          placeholder="留空则不修改"
          className="w-full bg-black/40 border border-slate-700 focus:border-accent rounded px-3 py-2 text-sm outline-none text-slate-200 mb-4"
        />
        <button onClick={handleSaveCloud189} className="px-4 py-2 rounded bg-accent2 text-black font-bold hover:shadow-glowCyan">
          保存
        </button>
        {cloud189Msg && <span className="ml-3 text-xs text-slate-400">{cloud189Msg}</span>}
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
        <div className="space-y-4">
          {Object.entries(PAN_LABELS).map(([key, label]) => {
            const enabled = config?.panEnabled[key] ?? true
            return (
              <div key={key} className="border-b border-slate-800/60 last:border-b-0 pb-3 last:pb-0">
                <div className="flex items-center justify-between text-sm">
                  <span>{label}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${label} 解析开关`}
                    onClick={() => togglePan(key, !enabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      enabled ? 'bg-accent' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-black transition-transform ${
                        enabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
                {!enabled && (
                  <input
                    type="text"
                    defaultValue={config?.panDisabledReasons[key] ?? ''}
                    onBlur={(e) => savePanDisabledReason(key, e.target.value)}
                    placeholder="关闭原因（选填，留空则显示默认提示）"
                    className="mt-2 w-full bg-black/40 border border-slate-700 focus:border-accent2 rounded px-3 py-1.5 text-xs outline-none text-slate-200"
                  />
                )}
              </div>
            )
          })}
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
