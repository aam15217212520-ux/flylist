import type { Env } from './parsers/shared/types'
import { resolveBaiduFinalUrl, BAIDU_DOWNLOAD_UA } from './parsers/baidu'
import { buildContentDisposition } from './parsers/shared/http'

const PASSTHROUGH_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
]

function isPlausibleId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

/**
 * 百度网盘下载代理。
 *
 * 百度网盘的 CDN 直链签名与“签发签名时的请求方 IP”绑定，签发和下载必须是同一个来源 IP，
 * 否则会被判定为 sign error(31362) 并返回 403。如果解析阶段签好直链再交给访客浏览器下载，
 * 访客浏览器的出口 IP 与我们服务器签发时的 IP 不一致，必然失败。
 *
 * 因此这里把“签发直链”这一步推迟到访客真正点击下载的这一次请求内完成，
 * 并在同一次 Function 调用里立刻用这个直链取流转发，保证签发和下载的 IP 始终一致，
 * 访客全程只连接本站域名。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const reqUrl = new URL(request.url)
  const accountId = reqUrl.searchParams.get('accountId')
  const fsId = reqUrl.searchParams.get('fsId')
  // 文件名优先取路径末段（/api/baidu-download/xxx.mov?...），IDM 等下载工具
  // 建任务时优先看 URL 路径而不是 Content-Disposition，路径带真实文件名才能正确命名
  const pathName = decodeURIComponent(reqUrl.pathname.split('/').pop() ?? '')
  const filename = pathName.includes('.') ? pathName : reqUrl.searchParams.get('name')

  if (!accountId || !fsId || !isPlausibleId(accountId) || !isPlausibleId(fsId)) {
    return new Response('invalid params', { status: 400 })
  }

  let finalUrl: string
  try {
    finalUrl = await resolveBaiduFinalUrl(env, accountId, fsId)
  } catch (error) {
    const message = error instanceof Error ? error.message : '百度网盘解析失败'
    return new Response(message, { status: 502 })
  }

  const upstreamHeaders: Record<string, string> = {
    'User-Agent': BAIDU_DOWNLOAD_UA,
  }
  const range = request.headers.get('Range')
  if (range) {
    upstreamHeaders.Range = range
  }

  const upstreamRes = await fetch(finalUrl, { headers: upstreamHeaders })

  if (!upstreamRes.ok && upstreamRes.status !== 206) {
    return new Response(`百度网盘下载失败（上游状态码 ${upstreamRes.status}）`, { status: 502 })
  }

  // 记录下载时间戳，供 /api/cleanup 判断「24 小时无人下载」后清理转存文件
  env.FLYLIST_KV.put(`baidudl:${accountId}:${fsId}`, String(Date.now())).catch(() => {})

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
