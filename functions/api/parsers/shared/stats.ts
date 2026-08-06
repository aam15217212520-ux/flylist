import type { Env } from './types'

const STATS_TTL_SECONDS = 60 * 60 * 24 * 400 // 保留约13个月

export async function incrementStats(env: Env, panType: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  await Promise.all([bump(env, 'stats:total'), bump(env, `stats:daily:${today}`), bump(env, `stats:pan:${panType}`)])
}

async function bump(env: Env, key: string): Promise<void> {
  const current = Number((await env.FLYLIST_KV.get(key)) ?? '0')
  await env.FLYLIST_KV.put(key, String(current + 1), { expirationTtl: STATS_TTL_SECONDS })
}
