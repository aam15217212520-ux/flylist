import type { Env } from './parsers/shared/types'
import { getSiteConfig } from './parsers/shared/config'

const QUARK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch'

function isAllowedQuarkHost(hostname: string): boolean {
  return hostname === 'quark.cn' || hostname.endsWith('.quark.cn')
}

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
 * 夸克网盘的直链只有携带管理员账号的登录 Cookie 才能访问（否则返回 412），
 * 而这个 Cookie 是账号的登录凭证，绝不能直接暴露给访客。
 * 因此这里由服务器代持 Cookie 向夸克 CDN 取流，再原样转发给用户浏览器，
 * 全程用户拿不到账号 Cookie，只拿到这个代理地址本身。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const reqUrl = new URL(request.url)
  const target = reqUrl.searchParams.get('u')
  const filename = reqUrl.searchParams.get('name')

  if (!target) {
    return new Response('missing url', { status: 400 })
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(target)
  } catch {
    return new Response('invalid url', { status: 400 })
  }

  if (targetUrl.protocol !== 'https:' || !isAllowedQuarkHost(targetUrl.hostname)) {
    return new Response('forbidden target host', { status: 403 })
  }

  const config = await getSiteConfig(env)
  const cookie = config.quark?.cookie
  if (!cookie) {
    return new Response('夸克网盘账号未配置', { status: 502 })
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

  const upstreamRes = await fetch(targetUrl.toString(), { headers: upstreamHeaders })

  if (!upstreamRes.ok && upstreamRes.status !== 206) {
    return new Response(`夸克网盘下载失败（上游状态码 ${upstreamRes.status}）`, { status: 502 })
  }

  const headers = new Headers()
  for (const h of PASSTHROUGH_RESPONSE_HEADERS) {
    const v = upstreamRes.headers.get(h)
    if (v) headers.set(h, v)
  }

  const dispositionName = filename ? decodeURIComponent(filename) : undefined
  headers.set(
    'Content-Disposition',
    dispositionName ? `attachment; filename*=UTF-8''${encodeURIComponent(dispositionName)}` : 'attachment',
  )

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers,
  })
}
