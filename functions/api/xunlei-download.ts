import type { Env } from './parsers/shared/types'
import { resolveXunleiFinalUrl, cleanupXunleiFiles } from './parsers/xunlei'
import { buildContentDisposition } from './parsers/shared/http'

const XUNLEI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'

const PASSTHROUGH_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
]

/**
 * 迅雷网盘下载代理。
 *
 * 解析阶段已经把分享文件转存到管理员账号，这里现场签发 web_content_link 并转发取流。
 * 取流响应拿到后立即删除转存文件，避免长期占用管理员网盘容量。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const reqUrl = new URL(request.url)
  const token = reqUrl.searchParams.get('token')
  const filename = reqUrl.searchParams.get('name')

  if (!token) {
    return new Response('missing token', { status: 400 })
  }

  let finalUrl: string
  try {
    finalUrl = await resolveXunleiFinalUrl(env, token)
  } catch (error) {
    const message = error instanceof Error ? error.message : '迅雷网盘解析失败'
    return new Response(message, { status: 502 })
  }

  const upstreamHeaders: Record<string, string> = {
    'User-Agent': XUNLEI_UA,
  }
  const range = request.headers.get('Range')
  if (range) {
    upstreamHeaders.Range = range
  }

  const upstreamRes = await fetch(finalUrl, { headers: upstreamHeaders })

  if (!upstreamRes.ok && upstreamRes.status !== 206) {
    await cleanupXunleiFiles(env, token)
    return new Response(`迅雷网盘下载失败（上游状态码 ${upstreamRes.status}）`, { status: 502 })
  }

  const headers = new Headers()
  for (const h of PASSTHROUGH_RESPONSE_HEADERS) {
    const v = upstreamRes.headers.get(h)
    if (v) headers.set(h, v)
  }

  headers.set('Content-Disposition', buildContentDisposition(filename ?? undefined))

  await cleanupXunleiFiles(env, token)

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers,
  })
}
