import type { Env } from './types'

export interface AnnouncementConfig {
  content: string
  enabled: boolean
  updatedAt: number
}

export interface SiteConfig {
  baidu?: { bduss: string; stoken: string; updatedAt: number }
  panEnabled?: Record<string, boolean>
  announcement?: AnnouncementConfig
}

export async function getSiteConfig(env: Env): Promise<SiteConfig> {
  return (await env.FLYLIST_KV.get('config:site', 'json')) ?? {}
}

export async function saveSiteConfig(env: Env, config: SiteConfig): Promise<void> {
  await env.FLYLIST_KV.put('config:site', JSON.stringify(config))
}
