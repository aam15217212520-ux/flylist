import type { Env } from './types'
import type { BaiduAccount } from './config'
import { getSiteConfig, saveSiteConfig } from './config'

/**
 * 百度网盘账号池：从状态正常的账号里选出最久未使用的一个。
 * 转存/下载失败时调用 markBaiduAccountFailed 标记该账号失效，下次自动换用其他账号。
 */
export async function pickBaiduAccount(env: Env): Promise<BaiduAccount | null> {
  const config = await getSiteConfig(env)
  const accounts = config.baiduAccounts ?? []
  const usable = accounts.filter((a) => a.status === 'normal')
  if (usable.length === 0) return null

  usable.sort((a, b) => a.lastUsedAt - b.lastUsedAt)
  return usable[0]
}

export async function markBaiduAccountUsed(env: Env, id: string): Promise<void> {
  const config = await getSiteConfig(env)
  const accounts = config.baiduAccounts ?? []
  const account = accounts.find((a) => a.id === id)
  if (!account) return
  account.lastUsedAt = Date.now()
  await saveSiteConfig(env, config)
}

export async function markBaiduAccountFailed(env: Env, id: string, reason: string): Promise<void> {
  const config = await getSiteConfig(env)
  const accounts = config.baiduAccounts ?? []
  const account = accounts.find((a) => a.id === id)
  if (!account) return
  account.status = 'disabled'
  account.lastError = reason
  await saveSiteConfig(env, config)
}

export function hasAnyBaiduAccount(accounts: BaiduAccount[] | undefined): boolean {
  return Boolean(accounts && accounts.length > 0)
}

export async function markBaiduAccountDirReady(env: Env, id: string): Promise<void> {
  const config = await getSiteConfig(env)
  const accounts = config.baiduAccounts ?? []
  const account = accounts.find((a) => a.id === id)
  if (!account) return
  account.dirReady = true
  await saveSiteConfig(env, config)
}
