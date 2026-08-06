import { fetchJson } from './shared/http'
import type { ParsedFile, ParserContext } from './shared/types'
import { ParseError } from './shared/types'

const API_BASE = 'https://webapi.ctfile.com'

interface CtFileInfo {
  code: number
  message?: string
  file?: {
    file_id: string
    file_chk: string
    userid: string | number
    start_time?: number
    wait_seconds?: number
    file_name?: string
    file_size?: string
  }
}

interface CtDownloadInfo {
  code: number
  message?: string
  downurl?: string
  file_name?: string
  file_size?: string
}

/**
 * 城通网盘 (ctfile.com) 解析。
 *
 * 城通的分享页是纯前端渲染的空壳页面（<main> 是空的），文件信息和下载直链
 * 都来自 webapi.ctfile.com 的两个接口，而不是像蓝奏云那样能从静态 HTML 里
 * 直接抠出字段：
 *   1) getfile.php      —— 用分享 key + 提取码换取 file_id / file_chk / userid
 *   2) get_file_url.php —— 用上面几个字段换取真实下载直链
 *
 * 注：该流程是通过抓取分享页加载的前端脚本逆向确认的，如遇解析失败，
 * 优先怀疑是 code=423（需要提取码/提取码错误）或链接本身已失效，
 * 其次再检查这里的参数格式是否需要跟进调整。
 */
export async function parseChengtong(ctx: ParserContext): Promise<ParsedFile> {
  const { url, pwd } = ctx
  const parsed = new URL(url)
  const pathParts = parsed.pathname.split('/')

  if (pathParts.length < 3 || !pathParts[2]) {
    throw new ParseError('无法识别城通网盘分享链接格式')
  }

  const shareKey = pathParts[2]
  const passcode = pwd ?? parsed.searchParams.get('p') ?? ''
  const pathParam = pathParts.join(',')

  const info = await fetchJson<CtFileInfo>(
    `${API_BASE}/getfile.php?path=${encodeURIComponent(pathParam)}&f=${encodeURIComponent(shareKey)}&passcode=${encodeURIComponent(passcode)}&r=${Math.random()}`,
    { headers: { Referer: url } },
  )

  if (info.code === 423) {
    throw new ParseError('该分享需要提取码，或提取码不正确')
  }
  if (info.code !== 200 || !info.file) {
    throw new ParseError(info.message ?? '城通网盘分享不存在或已失效')
  }

  const file = info.file

  const download = await fetchJson<CtDownloadInfo>(
    `${API_BASE}/get_file_url.php?uid=${file.userid}&fid=${file.file_id}&folder_id=0&share_id=&file_chk=${file.file_chk}&start_time=${file.start_time ?? 0}&wait_seconds=${file.wait_seconds ?? 0}&rd=${Math.random()}`,
    { headers: { Referer: url } },
  )

  if (download.code !== 200 || !download.downurl) {
    throw new ParseError(download.message ?? '城通网盘解析失败，可能需要等待倒计时或链接已失效')
  }

  return {
    panType: 'chengtong',
    panName: '城通网盘',
    fileName: download.file_name ?? file.file_name,
    fileSize: download.file_size ?? file.file_size,
    directLink: download.downurl,
  }
}
