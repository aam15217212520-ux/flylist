import type { Env } from './parsers/shared/types'
import { resolveQuarkFinalUrl } from './parsers/quark'
import { buildContentDisposition } from './parsers/shared/http'

const QUARK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch'

const PASSTHROUGH_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
]

/**
 * 夸克网盘下载代理。
 *
 * 夸克 CDN 直链的签名与“签发签名时的请求方 IP”绑定，签发和下载必须是同一个来源 IP，
 * 否则会被判定签名不符，返回 403（跟百度网盘同一个限制）。
 * 因此这里把“调用 file/download 现场签发直链”这一步推迟到访客真正点击下载的这一次请求内完成，
 * 并在同一次 Function 调用里立刻用这个直链取流转发，保证签发和下载的 IP 始终一致。
 * 访客全程只连接本站域名，账号 Cookie 始终留在服务端。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const reqUrl = new URL(request.url)
  const token = reqUrl.searchParams.get('token')
  const filename = reqUrl.searchParams.get('name')

  if (!token) {
    return new Response('missing token', { status: 400 })
  }

  let finalUrl: string
  let cookie: string
  try {
    const resolved = await resolveQuarkFinalUrl(env, token)
    finalUrl = resolved.url
    cookie = resolved.cookie
  } catch (error) {
    const message = error instanceof Error ? error.message : '夸克网盘解析失败'
    return new Response(message, { status: 502 })
  }

  const upstreamHeaders: Record<string, string> = {
    'User-Agent': QUARK_UA,
    Cookie: cookie,
    Referer: 'https://pan.quark.cn/',
  }
  const range = request.headers.get('Range')
  if (range) {
    upstreamHeaders.Range = range
  }

  const upstreamRes = await fetch(finalUrl, { headers: upstreamHeaders })

  if (!upstreamRes.ok && upstreamRes.status !== 206) {
    return new Response(`夸克网盘下载失败（上游状态码 ${upstreamRes.status}）`, { status: 502 })
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
