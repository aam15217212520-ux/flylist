import type { Env } from './types'

const CACHE_TTL_SECONDS = 60 * 30 // 直链缓存30分钟，避免同一链接被反复请求触发网盘风控

export async function getCachedLink(env: Env, key: string): Promise<string | null> {
  return env.FLYLIST_KV.get(`cache:${key}`)
}

export async function setCachedLink(env: Env, key: string, link: string): Promise<void> {
  await env.FLYLIST_KV.put(`cache:${key}`, link, { expirationTtl: CACHE_TTL_SECONDS })
}

const TRANSFER_TTL_SECONDS = 60 * 60 * 24 // 转存结果缓存 24h：同一分享文件一天内只转存一次

export async function getCachedTransfer(env: Env, key: string): Promise<string | null> {
  return env.FLYLIST_KV.get(`transfer:${key}`)
}

export async function setCachedTransfer(env: Env, key: string, value: string): Promise<void> {
  await env.FLYLIST_KV.put(`transfer:${key}`, value, { expirationTtl: TRANSFER_TTL_SECONDS })
}
