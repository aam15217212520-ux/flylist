import { fetchText } from './shared/http'
import type { ParsedFile, ParserContext } from './shared/types'
import { ParseError } from './shared/types'

/**
 * 城通网盘 (ctfile.com) 解析。
 * 城通的接口字段会随版本调整，如遇解析失败，优先检查这里的正则是否需要
 * 对照最新分享页源码更新。
 */
export async function parseChengtong(ctx: ParserContext): Promise<ParsedFile> {
  const { url, pwd } = ctx
  const origin = new URL(url).origin

  let html = await fetchText(url, { headers: { Referer: origin } })

  if (/请输入密码|passcode/i.test(html) && pwd) {
    html = await fetchText(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url },
      body: new URLSearchParams({ passcode: pwd }).toString(),
    })
  }

  const uidMatch = html.match(/'uid'\s*[:=]\s*'?(\d+)'?/) ?? html.match(/[?&]uid=(\d+)/)
  const fidMatch = html.match(/'fid'\s*[:=]\s*'?(\d+)'?/) ?? html.match(/[?&]fid=(\d+)/)

  if (!uidMatch || !fidMatch) {
    throw new ParseError('未能从城通网盘分享页提取文件标识，页面结构可能已更新')
  }

  const [uid, fid] = [uidMatch[1], fidMatch[1]]
  const ajaxUrl = `${origin}/get_file_url.php?uid=${uid}&fid=${fid}&folder_id=0`

  const jsonText = await fetchText(ajaxUrl, {
    headers: { Referer: url, 'X-Requested-With': 'XMLHttpRequest' },
  })

  let data: { url?: string; download_url?: string; file_name?: string }
  try {
    data = JSON.parse(jsonText)
  } catch {
    throw new ParseError('城通网盘返回内容异常，解析失败')
  }

  const directLink = data.url ?? data.download_url
  if (!directLink) {
    throw new ParseError('城通网盘解析失败，链接可能已失效或提取码错误')
  }

  return {
    panType: 'chengtong',
    panName: '城通网盘',
    fileName: data.file_name,
    directLink,
  }
}
