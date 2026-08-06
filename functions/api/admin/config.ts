import type { Env } from '../parsers/shared/types'
import { readJsonBody } from '../parsers/shared/http'
import { getSiteConfig, saveSiteConfig } from '../parsers/shared/config'
import { isAuthenticated } from './_session'

const DEFAULT_PAN_ENABLED: Record<string, boolean> = {
  lanzou: true,
  chengtong: true,
  feiji: true,
  pan123: true,
  baidu: true,
}

interface ConfigUpdateBody {
  bduss?: string
  stoken?: string
  panEnabled?: Record<string, boolean>
  announcement?: { content: string; enabled: boolean }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const authed = await isAuthenticated(request, env)
  if (!authed) return Response.json({ success: false, message: '未登录' }, { status: 401 })

  const config = await getSiteConfig(env)
  return Response.json({
    success: true,
    data: {
      baiduConfigured: Boolean(config.baidu?.bduss),
      baiduUpdatedAt: config.baidu?.updatedAt ?? null,
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

  if (body.bduss) {
    config.baidu = {
      bduss: body.bduss,
      stoken: body.stoken ?? config.baidu?.stoken ?? '',
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
