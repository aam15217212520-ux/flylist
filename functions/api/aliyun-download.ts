import type { Env } from './parsers/shared/types'
import { resolveAliyunFinalUrl, cleanupAliyunFile } from './parsers/aliyun'
import { buildContentDisposition } from './parsers/shared/http'

const PASSTHROUGH_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
]

function isPlausibleToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$/.test(token)
}

/**
 * 阿里云盘下载代理。
 *
 * 阿里云盘官方接口没有免登录直链，解析阶段已经把分享文件转存（复制）到管理员账号自己的网盘，
 * 这里现场签发这个转存文件的下载直链并转发取流。
 * 取流完成后立即调用删除接口清理这个转存文件，避免长期占用管理员网盘的存储空间。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const reqUrl = new URL(request.url)
  const token = reqUrl.searchParams.get('token')
  const filename = reqUrl.searchParams.get('name')

  if (!token || !isPlausibleToken(token)) {
    return new Response('invalid params', { status: 400 })
  }

  let finalUrl: string
  try {
    finalUrl = await resolveAliyunFinalUrl(env, token)
  } catch (error) {
    const message = error instanceof Error ? error.message : '阿里云盘解析失败'
    return new Response(message, { status: 502 })
  }

  const upstreamHeaders: Record<string, string> = {}
  const range = request.headers.get('Range')
  if (range) {
    upstreamHeaders.Range = range
  }

  const upstreamRes = await fetch(finalUrl, { headers: upstreamHeaders })

  if (!upstreamRes.ok && upstreamRes.status !== 206) {
    await cleanupAliyunFile(env, token)
    return new Response(`阿里云盘下载失败（上游状态码 ${upstreamRes.status}）`, { status: 502 })
  }

  const headers = new Headers()
  for (const h of PASSTHROUGH_RESPONSE_HEADERS) {
    const v = upstreamRes.headers.get(h)
    if (v) headers.set(h, v)
  }

  const dispositionName = filename ?? undefined
  headers.set('Content-Disposition', buildContentDisposition(dispositionName))

  // 转存文件用完即删，不等下载彻底完成（大文件下载可能持续很久），
  // 只要这次请求已经拿到了取流响应就说明该转存文件的使命已经完成。
  await cleanupAliyunFile(env, token)

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers,
  })
}
