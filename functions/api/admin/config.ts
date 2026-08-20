import type { Env } from '../parsers/shared/types'
import { readJsonBody } from '../parsers/shared/http'
import { getSiteConfig, saveSiteConfig } from '../parsers/shared/config'
import type { BaiduAccount } from '../parsers/shared/config'
import { isAuthenticated } from './_session'

const DEFAULT_PAN_ENABLED: Record<string, boolean> = {
  lanzou: true,
  chengtong: true,
  feiji: true,
  pan123: true,
  baidu: true,
  quark: true,
  gdrive: true,
  ilanzou: true,
}

interface ConfigUpdateBody {
  quarkCookie?: string
  panEnabled?: Record<string, boolean>
  announcement?: { content: string; enabled: boolean }
  addBaiduAccount?: { cookie: string; note?: string }
  editBaiduAccount?: { id: string; cookie?: string; note?: string }
  removeBaiduAccountId?: string
  setBaiduAccountStatus?: { id: string; status: 'normal' | 'disabled' }
}

function publicAccount(account: BaiduAccount) {
  // 出于安全考虑，永远不把完整 Cookie 明文回传给前端，只回传末尾几位用于辨认
  const masked = account.cookie.length > 6 ? `${'*'.repeat(account.cookie.length - 6)}${account.cookie.slice(-6)}` : '******'
  return {
    id: account.id,
    cookieMasked: masked,
    note: account.note ?? '',
    status: account.status,
    lastUsedAt: account.lastUsedAt,
    createdAt: account.createdAt,
    lastError: account.lastError ?? null,
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const authed = await isAuthenticated(request, env)
  if (!authed) return Response.json({ success: false, message: '未登录' }, { status: 401 })

  const config = await getSiteConfig(env)
  return Response.json({
    success: true,
    data: {
      baiduAccounts: (config.baiduAccounts ?? []).map(publicAccount),
      quarkConfigured: Boolean(config.quark?.cookie),
      quarkUpdatedAt: config.quark?.updatedAt ?? null,
      panEnabled: { ...DEFAULT_PAN_ENABLED, ...(config.panEnabled ?? {}) },
      announcement: {
        content: config.announcement?.content ?? '',
        enabled: config.announcement?.enabled ?? false,
        updatedAt: config.announcement?.updatedAt ?? null,
      },
    },
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authed = await isAuthenticated(request, env)
  if (!authed) return Response.json({ success: false, message: '未登录' }, { status: 401 })

  const body = await readJsonBody<ConfigUpdateBody>(request)
  if (!body) return Response.json({ success: false, message: '请求格式错误' }, { status: 400 })

  const config = await getSiteConfig(env)

  if (body.addBaiduAccount?.cookie) {
    const accounts = config.baiduAccounts ?? []
    const newAccount: BaiduAccount = {
      id: crypto.randomUUID(),
      cookie: body.addBaiduAccount.cookie,
      note: body.addBaiduAccount.note ?? '',
      status: 'normal',
      lastUsedAt: 0,
      createdAt: Date.now(),
    }
    config.baiduAccounts = [...accounts, newAccount]
  }

  if (body.removeBaiduAccountId) {
    config.baiduAccounts = (config.baiduAccounts ?? []).filter((a) => a.id !== body.removeBaiduAccountId)
  }

  if (body.editBaiduAccount) {
    const { id, cookie, note } = body.editBaiduAccount
    const accounts = config.baiduAccounts ?? []
    const account = accounts.find((a) => a.id === id)
    if (account) {
      if (cookie) {
        // Cookie 变了，说明账号被重新登录过，之前的失效状态和转存目录缓存都要重置
        account.cookie = cookie
        account.status = 'normal'
        account.lastError = undefined
        account.dirReady = false
      }
      if (note !== undefined) {
        account.note = note
      }
    }
  }

  if (body.setBaiduAccountStatus) {
    const { id, status } = body.setBaiduAccountStatus
    const accounts = config.baiduAccounts ?? []
    const account = accounts.find((a) => a.id === id)
    if (account) {
      account.status = status
      if (status === 'normal') account.lastError = undefined
    }
  }

  if (body.quarkCookie) {
    config.quark = {
      cookie: body.quarkCookie,
      updatedAt: Date.now(),
    }
  }

  if (body.panEnabled) {
    config.panEnabled = { ...DEFAULT_PAN_ENABLED, ...config.panEnabled, ...body.panEnabled }
  }

  if (body.announcement) {
    config.announcement = {
      content: body.announcement.content,
      enabled: body.announcement.enabled,
      updatedAt: Date.now(),
    }
  }

  await saveSiteConfig(env, config)
  return Response.json({ success: true })
}
