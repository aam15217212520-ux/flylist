import { DEFAULT_UA } from './shared/http'
import type { ParsedFile, ParserContext } from './shared/types'
import { ParseError } from './shared/types'

/**
 * Google Drive 解析。
 *
 * Google Drive 的公开分享不需要账号登录态，但下载流程比较特殊：
 *   - 小文件：直接 GET uc?export=download 就能拿到文件内容（Content-Disposition 是 attachment）
 *   - 大文件（约 100MB 以上）：Google 会返回一个"无法扫描病毒，是否仍要下载"的 HTML 确认页，
 *     需要从页面里提取确认参数，带着这些参数再请求一次才能拿到真正的文件流
 *     （处理逻辑参考自开源工具 gdown 的实现，https://github.com/wkentaro/gdown）
 *
 * 由于国内访问 Google 域名本身被阻断，这里解析出文件信息用于展示，
 * 真正取流转发交给 functions/api/gdrive-download.ts 代理完成，让访客的浏览器
 * 只连接我们自己的域名，不需要直连 Google。
 */

const ID_PATTERNS = [
  /\/file\/d\/([A-Za-z0-9_-]+)/,
  /\/file\/u\/\d+\/d\/([A-Za-z0-9_-]+)/,
  /\/uc\?.*[?&]id=([A-Za-z0-9_-]+)/,
  /\/open\?.*[?&]id=([A-Za-z0-9_-]+)/,
  /[?&]id=([A-Za-z0-9_-]+)/,
]

const FOLDER_PATTERN = /\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/

export function extractGoogleDriveFileId(url: string): string | null {
  for (const pattern of ID_PATTERNS) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

export function isGoogleDriveFolderUrl(url: string): boolean {
  return FOLDER_PATTERN.test(url)
}

/** 从 Set-Cookie 响应头里提取 name=value，与已有 cookie 合并成一个 Cookie 请求头字符串 */
function mergeCookies(existing: Map<string, string>, setCookies: string[]): void {
  for (const raw of setCookies) {
    const pair = raw.split(';', 1)[0]
    const eq = pair.indexOf('=')
    if (eq > 0) {
      existing.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }
}

function cookieHeader(cookies: Map<string, string>): string | undefined {
  if (cookies.size === 0) return undefined
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/** 从确认页 <input type="hidden"> 标签里提取 name/value，不依赖属性出现顺序 */
function extractHiddenInputs(html: string): Record<string, string> {
  const inputs: Record<string, string> = {}
  const tagMatches = html.matchAll(/<input\b[^>]*>/gi)
  for (const tagMatch of tagMatches) {
    const tag = tagMatch[0]
    if (!/type=["']hidden["']/i.test(tag)) continue
    const nameMatch = tag.match(/name=["']([^"']+)["']/i)
    const valueMatch = tag.match(/value=["']([^"']*)["']/i)
    if (nameMatch) {
      inputs[nameMatch[1]] = valueMatch ? valueMatch[1] : ''
    }
  }
  return inputs
}

/**
 * 从 Google Drive 的"无法扫描病毒"确认页 HTML 里提取下一步要请求的确认地址。
 * 按 gdown 验证过的优先级顺序依次尝试（https://github.com/wkentaro/gdown/blob/main/gdown/download.py）：
 *   1. 旧版链接：<a href="/uc?export=download&confirm=xxx&id=...">，需拼到 docs.google.com 域名下
 *   2. 新版确认表单：<form id="download-form" action="https://drive.usercontent.google.com/download?...">，
 *      连同页面里所有 <input type="hidden"> 字段一起提交
 *   3. 页面内嵌 JS 变量："downloadUrl":"..."
 *   4. 若命中 <p class="uc-error-subcaption">，说明请求被 Google 拒绝（文件不存在/未公开/超出下载次数等）
 */
function extractConfirmUrl(html: string, baseUrl: string): string | null {
  const hrefMatch = html.match(/href=["'](\/uc\?export=download[^"']+)["']/i)
  if (hrefMatch) {
    const href = hrefMatch[1].replace(/&amp;/g, '&')
    return new URL(href, 'https://docs.google.com').toString()
  }

  const formActionMatch = html.match(/<form[^>]+id=["']download-form["'][^>]*action=["']([^"']+)["']/i)
  if (formActionMatch) {
    const action = formActionMatch[1].replace(/&amp;/g, '&')
    const hidden = extractHiddenInputs(html)
    const target = new URL(action, baseUrl)
    for (const [key, value] of Object.entries(hidden)) {
      target.searchParams.set(key, value)
    }
    return target.toString()
  }

  const downloadUrlMatch = html.match(/"downloadUrl":"([^"]+)"/)
  if (downloadUrlMatch) {
    const raw = downloadUrlMatch[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&')
    return new URL(raw, baseUrl).toString()
  }

  const errorMatch = html.match(/<p class="uc-error-subcaption">([^<]*)<\/p>/i)
  if (errorMatch) {
    throw new ParseError(errorMatch[1] || 'Google Drive 拒绝了该请求，链接可能已失效或未公开')
  }

  return null
}

export interface GDriveResolveResult {
  response: Response
  finalUrl: string
  cookies: Map<string, string>
}

/**
 * 解析出 Google Drive 文件的真实二进制响应（不下载完整 body，调用方按需读取/取消）。
 * 自动跟随重定向、识别大文件确认页并带上确认参数重新请求，全程在服务端完成。
 */
export async function resolveGDriveFile(fileId: string): Promise<GDriveResolveResult> {
  let url = `https://drive.google.com/uc?id=${fileId}&export=download`
  const cookies = new Map<string, string>()

  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': DEFAULT_UA,
        ...(cookieHeader(cookies) ? { Cookie: cookieHeader(cookies)! } : {}),
      },
      redirect: 'manual',
    })

    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    if (setCookies.length) mergeCookies(cookies, setCookies)

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      await res.body?.cancel()
      if (!loc) throw new ParseError('Google Drive 重定向缺少目标地址')
      url = new URL(loc, url).toString()
      continue
    }

    if (!res.ok) {
      await res.body?.cancel()
      throw new ParseError(`Google Drive 返回异常状态码 ${res.status}`)
    }

    const disposition = res.headers.get('content-disposition')
    const contentType = res.headers.get('content-type') ?? ''

    if (disposition || !contentType.includes('text/html')) {
      // 已经是真实文件内容（小文件直接命中，或大文件确认后的最终响应）
      return { response: res, finalUrl: url, cookies }
    }

    const html = await res.text()
    const confirmUrl = extractConfirmUrl(html, url)
    if (!confirmUrl) {
      throw new ParseError('Google Drive 返回异常内容，链接可能已失效、被删除，或未开启"知道链接的任何人可查看"')
    }
    url = confirmUrl
  }

  throw new ParseError('Google Drive 确认流程跳转次数过多，请稍后重试')
}

function parseFileNameFromDisposition(disposition: string | null): string | undefined {
  if (!disposition) return undefined
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      // 忽略解码失败，继续尝试旧式语法
    }
  }
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i)
  return plainMatch ? plainMatch[1] : undefined
}

export async function parseGDrive(ctx: ParserContext): Promise<ParsedFile> {
  const { url } = ctx
  const fileId = extractGoogleDriveFileId(url)
  if (!fileId) {
    if (isGoogleDriveFolderUrl(url)) {
      throw new ParseError('暂不支持 Google Drive 文件夹分享，请使用单个文件的分享链接')
    }
    throw new ParseError('无法识别 Google Drive 分享链接格式')
  }

  let resolved: GDriveResolveResult
  try {
    resolved = await resolveGDriveFile(fileId)
  } catch (error) {
    if (error instanceof ParseError) throw error
    throw new ParseError('无法连接 Google Drive，请稍后重试')
  }

  const fileName = parseFileNameFromDisposition(resolved.response.headers.get('content-disposition'))
  const fileSize = resolved.response.headers.get('content-length') ?? undefined
  await resolved.response.body?.cancel()

  return {
    panType: 'gdrive',
    panName: 'Google Drive',
    fileName,
    fileSize,
    directLink: fileId,
  }
}

/** 把 fileId 包装成前端可直接点击的下载代理地址。 */
export function buildGDriveProxyLink(fileId: string, fileName?: string): string {
  const params = new URLSearchParams({ id: fileId })
  if (fileName) {
    params.set('name', fileName)
  }
  return `/api/gdrive-download?${params.toString()}`
}
