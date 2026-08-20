import type { Env, ParsedFile, ParsedFolder } from './parsers/shared/types'
import { ParseError, isParsedFolder } from './parsers/shared/types'
import { detectPanType, PAN_NAMES } from './parsers/detect'
import { parseLanzou } from './parsers/lanzou'
import { parseChengtong } from './parsers/chengtong'
import { parseFeiji } from './parsers/feiji'
import { parsePan123 } from './parsers/pan123'
import { parseBaidu, buildBaiduProxyLink } from './parsers/baidu'
import { parseQuark, buildQuarkProxyLink } from './parsers/quark'
import { parseGDrive, buildGDriveProxyLink } from './parsers/gdrive'
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
      data: {
        panType,
        panName: PAN_NAMES[panType],
        directLink: cached,
        cacheHit: true,
      },
    })
  }

  try {
    let result: ParsedFile | ParsedFolder

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
      case 'quark':
        result = await parseQuark({ env, url: body.url, pwd: body.pwd })
        break
      case 'gdrive':
        result = await parseGDrive({ env, url: body.url, pwd: body.pwd })
        break
    }

    if (isParsedFolder(result)) {
      return Response.json({ success: true, isFolder: true, data: result })
    }

    // 多个网盘的直链不能直接交给浏览器（夸克需要账号 Cookie，百度需要签发/下载同一 IP），
    // 这里换成走服务器代理下载的地址（Cookie/签名留在服务端），再缓存/返回这个代理地址。
    let responseLink = result.directLink
    if (panType === 'quark') {
      responseLink = buildQuarkProxyLink(result.directLink, result.fileName)
    } else if (panType === 'baidu') {
      responseLink = buildBaiduProxyLink(result.directLink, result.fileName)
    } else if (panType === 'gdrive') {
      responseLink = buildGDriveProxyLink(result.directLink, result.fileName)
    }

    await setCachedLink(env, cacheKey, responseLink)
    await incrementStats(env, panType)

    return Response.json({
      success: true,
      data: { ...result, directLink: responseLink, cacheHit: false },
    })
  } catch (error) {
    const message = error instanceof ParseError ? error.message : '解析失败，请检查链接或稍后重试'
    const fallbackUrl = error instanceof ParseError ? error.fallbackUrl : undefined
    return Response.json({ success: false, message, fallbackUrl }, { status: 502 })
  }
}
