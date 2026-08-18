import { fetchJson } from './shared/http'
import type { ParsedFile, ParserContext } from './shared/types'
import { ParseError } from './shared/types'

const API_BASE = 'https://webapi.ctfile.com'

interface CtFileInfo {
  code: number
  message?: string
  file?: {
    file_id?: string | number
    file_chk?: string
    userid?: string | number
    start_time?: number
    wait_seconds?: number
    file_name?: string
    file_size?: string
    message?: string
    is_vip?: number
    vip_dx_url?: string
    vip_yd_url?: string
    vip_lt_url?: string
    us_downurl_a?: string
  }
}

interface CtDownloadInfo {
  code?: number
  message?: string
  downurl?: string
  file_name?: string
  file_size?: string
}

function ctHeaders(shareUrl: string): Record<string, string> {
  return {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: shareUrl,
    Origin: new URL(shareUrl).origin,
  }
}

/**
 * 城通网盘 (ctfile.com) 解析。
 *
 * 分享页是纯前端渲染的空壳页面，文件信息和下载直链都来自 webapi.ctfile.com：
 *   1) getfile.php      —— 用 path(单字母路由类型 f/d) + 分享key + 提取码换取 file_id/file_chk/userid
 *   2) get_down_url.php —— 用上面几个字段换取真实下载直链
 *
 * 有一种情况不走第2步：文件是"VIP加速文件"（is_vip == 1）时，getfile.php 的响应里
 * 直接带了加速节点直链（vip_dx_url/vip_yd_url/vip_lt_url/us_downurl_a），要直接用，
 * 再调 get_down_url.php 反而拿不到东西。
 */
export async function parseChengtong(ctx: ParserContext): Promise<ParsedFile> {
  const { url, pwd } = ctx
  const parsed = new URL(url)
  const pathParts = parsed.pathname.split('/')

  if (pathParts.length < 3 || !pathParts[2]) {
    throw new ParseError('无法识别城通网盘分享链接格式')
  }

  const routeType = pathParts[1] // "f"(文件) 或 "d"(目录)
  const shareKey = pathParts[2]
  const passcode = pwd ?? parsed.searchParams.get('p') ?? ''
  const [fallbackUid, fallbackFid] = shareKey.split('-')

  const infoUrl =
    `${API_BASE}/getfile.php?path=${encodeURIComponent(routeType)}&f=${encodeURIComponent(shareKey)}` +
    `&passcode=${encodeURIComponent(passcode)}&r=${Math.random()}&ref=&url=${encodeURIComponent(url)}`

  const info = await fetchJson<CtFileInfo>(infoUrl, { headers: ctHeaders(url) })

  if (info.code === 423) {
    throw new ParseError(info.file?.message ?? '该分享需要提取码，或提取码不正确')
  }
  if (!info.file || !info.file.file_id) {
    throw new ParseError(info.file?.message ?? info.message ?? '城通网盘分享不存在或已失效')
  }

  const file = info.file
  const uid = String(file.userid ?? fallbackUid ?? '')
  const fid = String(file.file_id ?? fallbackFid ?? '')

  if (!uid || !fid || !file.file_chk) {
    throw new ParseError('城通网盘解析失败，下载参数不完整，可能分享已失效或提取码错误')
  }

  // VIP加速文件：直链已经在这一步的响应里了，不需要（也不能）再走 get_down_url.php
  if (file.is_vip === 1) {
    const vipUrl = file.vip_dx_url || file.vip_yd_url || file.vip_lt_url || file.us_downurl_a
    if (!vipUrl) {
      throw new ParseError('城通网盘解析失败，该VIP加速文件没有可用的下载节点')
    }
    return {
      panType: 'chengtong',
      panName: '城通网盘',
      fileName: file.file_name,
      fileSize: file.file_size,
      directLink: vipUrl,
    }
  }

  const downloadUrl =
    `${API_BASE}/get_down_url.php?uid=${uid}&fid=${fid}&file_chk=${file.file_chk}` +
    `&start_time=${file.start_time ?? 0}&wait_seconds=${file.wait_seconds ?? 0}&rd=${Math.random()}`

  const download = await fetchJson<CtDownloadInfo>(downloadUrl, { headers: ctHeaders(url) })

  if (!download.downurl) {
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
