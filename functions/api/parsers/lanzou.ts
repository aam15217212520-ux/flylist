import { fetchText } from './shared/http'
import type { ParsedFile, ParserContext } from './shared/types'
import { ParseError } from './shared/types'

// 蓝奏云的分享页会把解析签名内联在一段混淆 JS 里，变量名会不定期调整，
// 这里列了几种常见写法，命中任意一种即可，如后续解析失败大概率是这里的正则需要补充。
const SIGN_PATTERNS = [/'sign':'([^']+)'/, /sign\s*=\s*'([^']+)'/, /var\s+skdklds\s*=\s*'([^']+)'/]

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

export async function parseLanzou(ctx: ParserContext): Promise<ParsedFile> {
  const { url, pwd } = ctx
  const origin = new URL(url).origin

  const html = await fetchText(url, { headers: { Referer: origin } })

  if (/verify|acw_sc__v2/i.test(html) && !/ajaxm\.php/i.test(html)) {
    throw new ParseError('蓝奏云返回了人机验证页面，暂时无法自动解析，请稍后重试')
  }

  const sign = extractSign(html)
  if (!sign) {
    throw new ParseError('未能从蓝奏云分享页提取解析签名，页面结构可能已更新')
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
