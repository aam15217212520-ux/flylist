import type { Env, ParsedFile } from './parsers/shared/types'
import { ParseError } from './parsers/shared/types'
import { detectPanType, PAN_NAMES } from './parsers/detect'
import { parseLanzou } from './parsers/lanzou'
import { parseChengtong } from './parsers/chengtong'
import { parseFeiji } from './parsers/feiji'
import { parsePan123 } from './parsers/pan123'
import { parseBaidu } from './parsers/baidu'
import { getCachedLink, setCachedLink } from './parsers/shared/cache'
import { incrementStats } from './parsers/shared/stats'
import { getSiteConfig } from './parsers/shared/config'
import { readJsonBody } from './parsers/shared/http'

interface ParseRequestBody {
  url?: string
  pwd?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await readJsonBody<ParseRequestBody>(request)

  if (!body?.url) {
    return Response.json({ success: false, message: '请提供分享链接' }, { status: 400 })
  }

  const panType = detectPanType(body.url)
  if (!panType) {
    return Response.json({ success: false, message: '暂不支持该网盘，或链接格式不正确' }, { status: 400 })
  }

  const config = await getSiteConfig(env)
  if (config.panEnabled && config.panEnabled[panType] === false) {
    return Response.json({ success: false, message: '该网盘解析已被管理员暂时关闭' }, { status: 403 })
  }

  const cacheKey = `${panType}:${body.url}:${body.pwd ?? ''}`
  const cached = await getCachedLink(env, cacheKey)
  if (cached) {
    await incrementStats(env, panType)
    return Response.json({
      success: true,
      data: { panType, panName: PAN_NAMES[panType], directLink: cached, cacheHit: true },
    })
  }

  try {
    let result: ParsedFile

    switch (panType) {
      case 'lanzou':
        result = await parseLanzou({ env, url: body.url, pwd: body.pwd })
        break
      case 'chengtong':
        result = await parseChengtong({ env, url: body.url, pwd: body.pwd })
        break
      case 'feiji':
        result = await parseFeiji({ env, url: body.url, pwd: body.pwd })
        break
      case 'pan123':
        result = await parsePan123({ env, url: body.url, pwd: body.pwd })
        break
      case 'baidu':
        result = await parseBaidu({ env, url: body.url, pwd: body.pwd })
        break
    }

    await setCachedLink(env, cacheKey, result.directLink)
    await incrementStats(env, panType)

    return Response.json({ success: true, data: { ...result, cacheHit: false } })
  } catch (error) {
    const message = error instanceof ParseError ? error.message : '解析失败，请检查链接或稍后重试'
    const fallbackUrl = error instanceof ParseError ? error.fallbackUrl : undefined
    return Response.json({ success: false, message, fallbackUrl }, { status: 502 })
  }
}
