import type { Env } from './types'

export interface AnnouncementConfig {
  content: string
  enabled: boolean
  updatedAt: number
}

/** 百度网盘账号池中的单个账号。status 为 disabled 时不会被选中使用，
 * 直到管理员在后台手动重新启用（比如确认账号已恢复正常后）。 */
export interface BaiduAccount {
  id: string
  /** 完整 Cookie 字符串（包含 BAIDUID/BDUSS 等）。
   * 注意：单独的 BDUSS 不够用，百度网盘自己管理域的接口（gettemplatevariable/api/list 等）
   * 需要 BAIDUID 与 BDUSS 搭配才会认为已登录，否则会被判定为匿名访客（errno -6）。 */
  cookie: string
  note?: string
  status: 'normal' | 'disabled'
  lastUsedAt: number
  createdAt: number
  lastError?: string
  /** 该账号自己的网盘里是否已经存在 /parse_file 目录，避免每次转存都重复检查/创建 */
  dirReady?: boolean
}

export interface SiteConfig {
  baiduAccounts?: BaiduAccount[]
  quark?: { cookie: string; updatedAt: number }
  panEnabled?: Record<string, boolean>
  announcement?: AnnouncementConfig
}

export async function getSiteConfig(env: Env): Promise<SiteConfig> {
  return (await env.FLYLIST_KV.get('config:site', 'json')) ?? {}
}

export async function saveSiteConfig(env: Env, config: SiteConfig): Promise<void> {
  await env.FLYLIST_KV.put('config:site', JSON.stringify(config))
}
