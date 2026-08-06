import { fetchText } from './shared/http'
import type { ParsedFile, ParserContext } from './shared/types'
import { ParseError } from './shared/types'

// 蓝奏云现在的分享页会直接把下载直链渲染在页面里的
// <a class="txt" href="...">普通下载</a> 之类的按钮上（指向 developer*.lanrar.com
// 这个专门的下载域名），不再需要走以前 sign + ajaxm.php 那套签名流程。
// 优先尝试这种新版解析方式，如果没匹配到再回退到旧版 sign 方式
// （部分镜像域名可能还在用旧机制）。
const DIRECT_LINK_PATTERNS = [
  /<a[^>]+class=["']txt["'][^>]+href=["']([^"']+)["'][^>]*>\s*(?:电信下载|联通下载|普通下载)\s*<\/a>/,
  /href=["'](https?:\/\/developer\d*\.lanrar\.com\/file\/\?[^"']+)["']/,
]

const SIGN_PATTERNS = [/'sign':'([^']+)'/, /sign\s*=\s*'([^']+)'/, /var\s+skdklds\s*=\s*'([^']+)'/]

function decodeHtmlEntities(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

function extractDirectLink(html: string): string | null {
  for (const pattern of DIRECT_LINK_PATTERNS) {
    const match = html.match(pattern)
    if (match) return decodeHtmlEntities(match[1])
  }
  return null
}

function extractSign(html: string): string | null {
  for (const pattern of SIGN_PATTERNS) {
    const match = html.match(pattern)
    if (match) return match[1]
  }
  return null
}

function extractFileId(text: string): string | null {
  const match = text.match(/\/([a-zA-Z0-9]{5,})(?:\.htm)?(?:[?#]|$)/)
  return match ? match[1] : null
}

async function fetchShareHtml(url: string, pwd?: string): Promise<string> {
  const origin = new URL(url).origin
  let html = await fetchText(url, { headers: { Referer: origin } })

  const needsPassword = /请输入密码|输入访问密码|id=["']pwd["']/i.test(html)
  if (needsPassword) {
    if (!pwd) {
      throw new ParseError('该分享需要提取码')
    }
    html = await fetchText(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url },
      body: new URLSearchParams({ p: pwd }).toString(),
    })
  }
  return html
}

export async function parseLanzou(ctx: ParserContext): Promise<ParsedFile> {
  const { url, pwd } = ctx
  const origin = new URL(url).origin

  const html = await fetchShareHtml(url, pwd)

  // 新版：页面已经直接渲染出下载直链
  const directLink = extractDirectLink(html)
  if (directLink) {
    return { panType: 'lanzou', panName: '蓝奏云', directLink }
  }

  if (/acw_sc__v2/i.test(html)) {
    throw new ParseError('蓝奏云返回了人机验证页面，暂时无法自动解析，请稍后重试')
  }

  // 旧版兼容：走 sign + ajaxm.php
  const sign = extractSign(html)
  if (!sign) {
    throw new ParseError('未能从蓝奏云分享页提取下载信息，页面结构可能已更新')
  }

  const fileId = extractFileId(url)
  const ajaxUrl = `${origin}/ajaxm.php${fileId ? `?file=${fileId}` : ''}`

  const body = new URLSearchParams({
    action: 'downprocess',
    sign,
    ...(pwd ? { p: pwd } : {}),
  })

  const ajaxRes = await fetch(ajaxUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: url,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  })

  const data = (await ajaxRes.json()) as { zt: number; dom?: string; url?: string; inf?: string }

  if (data.zt !== 1 || !data.dom || !data.url) {
    throw new ParseError('蓝奏云解析失败，链接可能已失效或提取码错误')
  }

  return {
    panType: 'lanzou',
    panName: '蓝奏云',
    fileName: data.inf,
    directLink: `${data.dom}${data.url}`,
  }
}
