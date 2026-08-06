import { fetchText, DEFAULT_UA } from './shared/http'
import type { ParsedFile, ParserContext } from './shared/types'
import { ParseError } from './shared/types'

// 蓝奏云现在的分享页会直接把下载直链渲染在页面里的
// <a class="txt" href="...">普通下载</a> 之类的按钮上（指向 developer*.lanrar.com
// 这个专门的下载域名），不再需要走以前 sign + ajaxm.php 那套签名流程。
const DIRECT_LINK_PATTERNS = [
  /<a[^>]+class=["']txt["'][^>]+href=["']([^"']+)["'][^>]*>\s*(?:电信下载|联通下载|普通下载)\s*<\/a>/,
  /href=["'](https?:\/\/developer\d*\.lanrar\.com\/file\/\?[^"']+)["']/,
]

const SIGN_PATTERNS = [/'sign':'([^']+)'/, /sign\s*=\s*'([^']+)'/, /var\s+skdklds\s*=\s*'([^']+)'/]

// 阿里云WAF人机验证(acw_sc__v2)是一个置换+异或的确定性算法，
// 不需要真的跑一个浏览器去执行JS，纯计算即可复现。
const ACW_POS_LIST = [
  15, 35, 29, 24, 33, 16, 1, 38, 10, 9, 19, 31, 40, 27, 22, 23, 25, 13, 6, 11, 39, 18, 20, 8, 14, 21, 32, 26, 2, 30, 7,
  4, 17, 5, 3, 28, 34, 37, 12, 36,
]
const ACW_MASK = '3000176000856006061501533003690027800375'

function solveAcwScV2(arg1: string): string {
  const outPutList: string[] = new Array(40).fill('')
  for (let i = 0; i < arg1.length; i++) {
    const ch = arg1[i]
    for (let j = 0; j < ACW_POS_LIST.length; j++) {
      if (ACW_POS_LIST[j] === i + 1) {
        outPutList[j] = ch
      }
    }
  }
  const arg2 = outPutList.join('')
  const length = Math.min(arg2.length, ACW_MASK.length)
  let result = ''
  for (let i = 0; i < length; i += 2) {
    const strVal = parseInt(arg2.substring(i, i + 2), 16)
    const maskVal = parseInt(ACW_MASK.substring(i, i + 2), 16)
    result += (strVal ^ maskVal).toString(16).padStart(2, '0')
  }
  return result
}

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

/** 请求分享页；如果遇到 acw_sc__v2 人机验证页，自动算出验证值并带着重新请求一次 */
async function fetchShareHtmlBypassWaf(url: string, origin: string): Promise<string> {
  const html = await fetchText(url, { headers: { Referer: origin } })

  const arg1Match = html.match(/arg1\s*=\s*'([0-9A-Fa-f]+)'/)
  if (!arg1Match) return html

  const acwCookie = solveAcwScV2(arg1Match[1])
  const res = await fetch(url, {
    headers: {
      'User-Agent': DEFAULT_UA,
      Referer: origin,
      Cookie: `acw_sc__v2=${acwCookie}`,
    },
  })
  return res.text()
}

async function fetchShareHtml(url: string, pwd?: string): Promise<string> {
  const origin = new URL(url).origin
  let html = await fetchShareHtmlBypassWaf(url, origin)

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
    throw new ParseError('蓝奏云触发了人机验证，服务器自动越过尝试未成功，请在新标签页打开原始链接自行下载', url)
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
