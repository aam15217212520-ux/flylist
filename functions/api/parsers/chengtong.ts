import { fetchJson } from './shared/http'
import type { ParsedFile, ParsedFolder, ParserContext } from './shared/types'
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

interface CtDirInfo {
  code: number
  message?: string
  file?: {
    message?: string
    folder_name?: string
    url?: string
  }
}

interface CtFileListResp {
  aaData?: string[][]
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
 *
 * 文件夹分享（path 为 "d"）走另一套接口：
 *   1) getdir.php  —— 换取当前目录信息，响应里的 file.url 是文件列表接口的相对路径
 *   2) file.url 对应的接口（DataTables 用的 file_act/file_list）返回当前目录下的
 *      文件/子文件夹列表，每一行都是拼好的 HTML，需要用正则从里面抠出子目录 id/key
 *      或文件的临时令牌（tempdir-xxx）
 *   3) 子文件夹：把 id/key 拼成新的 URL 查询参数（?d=xxx&fk=xxx），前端点击后再次
 *      调用本函数递归展开；文件：临时令牌可以直接拼成 /f/{token} 走单文件分享的
 *      getfile.php 逻辑换取下载直链
 */
export async function parseChengtong(ctx: ParserContext): Promise<ParsedFile | ParsedFolder> {
  const { url, pwd } = ctx
  const parsed = new URL(url)
  const pathParts = parsed.pathname.split('/')

  if (pathParts.length < 3 || !pathParts[2]) {
    throw new ParseError('无法识别城通网盘分享链接格式')
  }

  const routeType = pathParts[1] // "f"(文件) 或 "d"(目录)
  const shareKey = pathParts[2]
  const passcode = pwd && pwd.length > 0 ? pwd : parsed.searchParams.get('p') ?? ''

  if (routeType === 'd') {
    const folderId = parsed.searchParams.get('d') ?? ''
    const folderKey = parsed.searchParams.get('fk') ?? ''
    return parseChengtongFolder(url, shareKey, passcode, folderId, folderKey)
  }

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

/**
 * 解析城通网盘文件夹分享（path 为 "d"）。
 *
 * folderId/folderKey 为空时表示分享的根目录，否则表示用户点开了某个子文件夹
 * （对应官方前端的 load_subdir(folder_id, folder_key)）。
 */
async function parseChengtongFolder(
  shareUrl: string,
  shareKey: string,
  passcode: string,
  folderId = '',
  folderKey = '',
): Promise<ParsedFolder> {
  const dirUrl =
    `${API_BASE}/getdir.php?path=d&d=${encodeURIComponent(shareKey)}` +
    `&folder_id=${encodeURIComponent(folderId)}&fk=${encodeURIComponent(folderKey)}` +
    `&passcode=${encodeURIComponent(passcode)}&r=${Math.random()}&ref=&url=${encodeURIComponent(shareUrl)}`

  const dir = await fetchJson<CtDirInfo>(dirUrl, { headers: ctHeaders(shareUrl) })

  if (dir.code === 423) {
    throw new ParseError(dir.file?.message ?? '该分享需要提取码，或提取码不正确')
  }
  if (!dir.file || !dir.file.url) {
    throw new ParseError(dir.file?.message ?? dir.message ?? '城通网盘分享不存在或已失效')
  }

  const listUrl = `${API_BASE}${dir.file.url}&iDisplayStart=0&iDisplayLength=-1`
  const list = await fetchJson<CtFileListResp>(listUrl, { headers: ctHeaders(shareUrl) })

  const origin = new URL(shareUrl).origin
  const files: ParsedFolder['files'] = []

  for (const row of list.aaData ?? []) {
    const nameCell = row[1] ?? ''
    const sizeCell = row[2] ?? ''

    const subdirMatch = nameCell.match(/load_subdir\((\d+),\s*'([^']+)'\)"[^>]*>([^<]*)</)
    if (subdirMatch) {
      const [, subFolderId, subFolderKey, subFolderName] = subdirMatch
      const folderUrl = `${origin}/d/${shareKey}?d=${subFolderId}&fk=${subFolderKey}${passcode ? `&p=${encodeURIComponent(passcode)}` : ''}`
      files.push({ fileId: `dir-${subFolderId}`, fileName: `📁 ${subFolderName}`, url: folderUrl })
      continue
    }

    const fileMatch = nameCell.match(/href="#\/f\/([^"]+)"[^>]*>([^<]*)</)
    if (fileMatch) {
      const [, token, fileName] = fileMatch
      const fileUrl = `${origin}/f/${token}`
      files.push({ fileId: token, fileName, fileSize: sizeCell === '- -' ? undefined : sizeCell, url: fileUrl })
    }
  }

  return {
    panType: 'chengtong',
    panName: '城通网盘',
    folderName: dir.file.folder_name,
    files,
  }
}
