import type { Env } from './parsers/shared/types'
import { DEFAULT_UA, buildContentDisposition } from './parsers/shared/http'
import { resolveGDriveFile } from './parsers/gdrive'

const PASSTHROUGH_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
]

function isPlausibleFileId(id: string): boolean {
  return /^[A-Za-z0-9_-]{10,100}$/.test(id)
}

function cookieHeader(cookies: Map<string, string>): string | undefined {
  if (cookies.size === 0) return undefined
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/**
 * Google Drive 下载代理。
 *
 * Google Drive 公开分享不需要登录 Cookie，但国内网络环境直连 Google 域名会被阻断，
 * 因此由服务器代替访客向 Google 取流（走 Cloudflare 的境外网络出口），
 * 再把内容原样转发给访客浏览器，访客全程只需要连接本站域名。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const reqUrl = new URL(request.url)
  const fileId = reqUrl.searchParams.get('id')
  const filename = reqUrl.searchParams.get('name')

  if (!fileId || !isPlausibleFileId(fileId)) {
    return new Response('invalid file id', { status: 400 })
  }

  let resolved: Awaited<ReturnType<typeof resolveGDriveFile>>
  try {
    resolved = await resolveGDriveFile(fileId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Drive 解析失败'
    return new Response(message, { status: 502 })
  }

  const range = request.headers.get('Range')
  let upstreamRes = resolved.response

  // 探测阶段没有带 Range 请求头，如果访客的下载器需要分块/续传，这里换一次带 Range 的正式请求
  if (range) {
    await upstreamRes.body?.cancel()
    upstreamRes = await fetch(resolved.finalUrl, {
      headers: {
        'User-Agent': DEFAULT_UA,
        Range: range,
        ...(cookieHeader(resolved.cookies) ? { Cookie: cookieHeader(resolved.cookies)! } : {}),
      },
    })
    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      return new Response(`Google Drive 下载失败（上游状态码 ${upstreamRes.status}）`, { status: 502 })
    }
  }

  const headers = new Headers()
  for (const h of PASSTHROUGH_RESPONSE_HEADERS) {
    const v = upstreamRes.headers.get(h)
    if (v) headers.set(h, v)
  }

  const dispositionName = filename ?? undefined
  headers.set('Content-Disposition', buildContentDisposition(dispositionName))

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers,
  })
}
