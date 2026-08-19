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
}

interface ConfigUpdateBody {
  quarkCookie?: string
  panEnabled?: Record<string, boolean>
  announcement?: { content: string; enabled: boolean }
  addBaiduAccount?: { bduss: string; note?: string }
  removeBaiduAccountId?: string
  setBaiduAccountStatus?: { id: string; status: 'normal' | 'disabled' }
}

function publicAccount(account: BaiduAccount) {
  // 出于安全考虑，永远不把完整 BDUSS 明文回传给前端，只回传末尾几位用于辨认
  const masked = account.bduss.length > 6 ? `${'*'.repeat(account.bduss.length - 6)}${account.bduss.slice(-6)}` : '******'
  return {
    id: account.id,
    bdussMasked: masked,
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

  if (body.addBaiduAccount?.bduss) {
    const accounts = config.baiduAccounts ?? []
    const newAccount: BaiduAccount = {
      id: crypto.randomUUID(),
      bduss: body.addBaiduAccount.bduss,
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
