import { fetchJson } from './shared/http'
import type { Env, ParsedFile, ParsedFolder, ParserContext } from './shared/types'
import { ParseError } from './shared/types'
import { getSiteConfig, saveSiteConfig } from './shared/config'

const API_BASE = 'https://api.aliyundrive.com'
const AUTH_BASE = 'https://auth.aliyundrive.com'
const ALIYUN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function aliyunHeaders(accessToken: string, shareToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': ALIYUN_UA,
    'Content-Type': 'application/json;charset=UTF-8',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://www.alipan.com',
    Referer: 'https://www.alipan.com/',
    'X-Canary': 'client=windows,app=adrive,version=v6.0.0',
    Authorization: `Bearer ${accessToken}`,
  }
  if (shareToken) {
    headers['X-Share-Token'] = shareToken
  }
  return headers
}

interface TokenRefreshResp {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  code?: string
  message?: string
}

/**
 * 阿里云盘的 access_token 有效期只有 2 小时，这里用 refresh_token 换一个新的，
 * 并把新的 access_token / refresh_token（阿里云盘的 refresh_token 是一次性的，
 * 用一次就会失效换新）写回 KV，下次解析直接复用，避免每次都重新刷新。
 */
async function refreshAccessToken(env: Env): Promise<string> {
  const config = await getSiteConfig(env)
  const refreshToken = config.aliyun?.refreshToken
  if (!refreshToken) {
    throw new ParseError('管理员尚未在后台配置阿里云盘账号，暂不支持解析')
  }

  const resp = await fetchJson<TokenRefreshResp>(`${AUTH_BASE}/v2/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })

  if (!resp.access_token || !resp.refresh_token) {
    throw new ParseError(resp.message ?? '阿里云盘账号登录态已失效，请在后台重新配置')
  }

  config.aliyun = {
    refreshToken: resp.refresh_token,
    accessToken: resp.access_token,
    accessTokenExpiresAt: Date.now() + (resp.expires_in ?? 7200) * 1000 - 60_000,
    updatedAt: Date.now(),
  }
  await saveSiteConfig(env, config)
  return resp.access_token
}

/** 获取一个可用的 access_token：缓存未过期就直接用缓存，否则用 refresh_token 换新的 */
async function getValidAccessToken(env: Env): Promise<string> {
  const config = await getSiteConfig(env)
  const aliyun = config.aliyun
  if (aliyun?.accessToken && (aliyun.accessTokenExpiresAt ?? 0) > Date.now()) {
    return aliyun.accessToken
  }
  return refreshAccessToken(env)
}

function extractShareId(url: string): { shareId: string; extractedPwd: string | null } | null {
  const patterns = [
    /alipan\.com\/s\/([a-zA-Z0-9]+)/i,
    /aliyundrive\.com\/s\/([a-zA-Z0-9]+)/i,
    /alipan\.com\/t\/([a-zA-Z0-9]+)/i,
    /aliyundrive\.com\/t\/([a-zA-Z0-9]+)/i,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return { shareId: match[1], extractedPwd: null }
  }
  return null
}

interface ShareTokenResp {
  share_token?: string
  message?: string
}

interface AliyunFileItem {
  file_id: string
  name: string
  type: 'file' | 'folder'
  size?: number
}

interface ListFilesResp {
  items?: AliyunFileItem[]
}

interface UserGetResp {
  default_drive_id?: string
}

interface CopyResp {
  file_id?: string
  body?: { file_id?: string }
  data?: { file_id?: string }
}

interface DownloadUrlResp {
  url?: string
  code?: string
  message?: string
}

async function getShareToken(shareId: string, pwd: string | undefined, accessToken: string): Promise<string> {
  const resp = await fetchJson<ShareTokenResp>(`${API_BASE}/v2/share_link/get_share_token`, {
    method: 'POST',
    headers: aliyunHeaders(accessToken),
    body: JSON.stringify({ share_id: shareId, ...(pwd ? { share_pwd: pwd } : {}) }),
  })
  if (!resp.share_token) {
    throw new ParseError(resp.message ?? '阿里云盘获取分享信息失败，可能是提取码错误、分享已失效，或账号登录态已过期')
  }
  return resp.share_token
}

async function listShareFiles(
  shareId: string,
  shareToken: string,
  accessToken: string,
  parentFileId = 'root',
): Promise<AliyunFileItem[]> {
  const resp = await fetchJson<ListFilesResp>(`${API_BASE}/adrive/v3/file/list`, {
    method: 'POST',
    headers: aliyunHeaders(accessToken, shareToken),
    body: JSON.stringify({
      share_id: shareId,
      parent_file_id: parentFileId,
      limit: 100,
      order_by: 'name',
      order_direction: 'ASC',
    }),
  })
  return resp.items ?? []
}

/**
 * 阿里云盘解析。官方接口没有免登录直链，必须先把分享文件转存（复制）到管理员账号自己的网盘，
 * 才能拿到下载直链，因此每次访客解析都会占用管理员网盘的存储空间。
 * 为了避免长期占用容量，下载代理在访客取流完成后会立即把转存的文件从网盘删除
 * （见 functions/api/aliyun-download.ts）。
 * 分享如果是文件夹，返回文件列表供访客逐级选择，跟百度/夸克同一个模式，
 * 通过 URL 上的 __adir 参数记录当前浏览的目录 file_id。
 */
export async function parseAliyun(ctx: ParserContext): Promise<ParsedFile | ParsedFolder> {
  const { url, pwd, env } = ctx
  const shareInfo = extractShareId(url)
  if (!shareInfo) {
    throw new ParseError('无法识别阿里云盘分享链接格式')
  }
  const { shareId } = shareInfo

  const accessToken = await getValidAccessToken(env)

  let parentFileId = 'root'
  try {
    parentFileId = new URL(url).searchParams.get('__adir') || 'root'
  } catch {
    // 忽略，按根目录处理
  }

  const shareToken = await getShareToken(shareId, pwd, accessToken)
  const items = await listShareFiles(shareId, shareToken, accessToken, parentFileId)

  if (!items.length) {
    throw new ParseError('该分享目录下没有文件')
  }

  const files = items.filter((item) => item.type === 'file')
  const folders = items.filter((item) => item.type === 'folder')

  if (parentFileId === 'root' && files.length === 1 && folders.length === 0) {
    return resolveAliyunDownload(env, accessToken, shareId, shareToken, files[0])
  }

  const folderItems: ParsedFolder['files'] = []
  for (const item of folders) {
    folderItems.push({
      fileId: `dir-${item.file_id}`,
      fileName: `📁 ${item.name}`,
      url: `${url.split('?')[0]}?__adir=${item.file_id}`,
    })
  }
  for (const item of files) {
    folderItems.push({
      fileId: item.file_id,
      fileName: item.name,
      fileSize: item.size ? String(item.size) : undefined,
      url: `${url.split('?')[0]}?__adir=${parentFileId}&__afid=${item.file_id}`,
    })
  }

  const afid = (() => {
    try {
      return new URL(url).searchParams.get('__afid')
    } catch {
      return null
    }
  })()
  if (afid) {
    const target = files.find((item) => item.file_id === afid)
    if (!target) {
      throw new ParseError('未找到该文件，链接可能已失效')
    }
    return resolveAliyunDownload(env, accessToken, shareId, shareToken, target)
  }

  return {
    panType: 'aliyun',
    panName: '阿里云盘',
    files: folderItems,
  }
}

async function resolveAliyunDownload(
  env: Env,
  accessToken: string,
  shareId: string,
  shareToken: string,
  file: AliyunFileItem,
): Promise<ParsedFile> {
  const userInfo = await fetchJson<UserGetResp>(`${API_BASE}/v2/user/get`, {
    method: 'POST',
    headers: aliyunHeaders(accessToken),
    body: JSON.stringify({}),
  })
  const driveId = userInfo.default_drive_id
  if (!driveId) {
    throw new ParseError('阿里云盘账号登录态已过期，请在后台更新')
  }

  const copyResp = await fetchJson<CopyResp>(`${API_BASE}/adrive/v2/file/copy`, {
    method: 'POST',
    headers: aliyunHeaders(accessToken, shareToken),
    body: JSON.stringify({
      file_id: file.file_id,
      to_parent_file_id: 'root',
      to_drive_id: driveId,
      share_id: shareId,
      auto_rename: true,
    }),
  })
  const newFileId = copyResp.file_id ?? copyResp.body?.file_id ?? copyResp.data?.file_id
  if (!newFileId) {
    throw new ParseError('阿里云盘转存文件失败，链接可能已失效或账号登录态已过期')
  }

  return {
    panType: 'aliyun',
    panName: '阿里云盘',
    fileName: file.name,
    fileSize: file.size ? String(file.size) : undefined,
    // 复合令牌：driveId:fileId，真正的下载直链推迟到访客点击下载时现场签发，
    // 下载完成后立即删除这个转存文件，避免占用管理员网盘容量。
    directLink: `${driveId}:${newFileId}`,
  }
}

/**
 * 在“下载代理”这一次请求内现场签发下载直链，取流完成后立即删除转存文件。
 */
export async function resolveAliyunFinalUrl(env: Env, token: string): Promise<string> {
  const [driveId, fileId] = token.split(':')
  if (!driveId || !fileId) {
    throw new Error('链接参数无效，请重新解析')
  }
  const accessToken = await getValidAccessToken(env)

  const resp = await fetchJson<DownloadUrlResp>(`${API_BASE}/v2/file/get_download_url`, {
    method: 'POST',
    headers: aliyunHeaders(accessToken),
    body: JSON.stringify({ drive_id: driveId, file_id: fileId }),
  })

  if (!resp.url) {
    throw new Error(resp.message ?? '阿里云盘获取下载直链失败，文件可能已被清理，请重新解析')
  }
  return resp.url
}

/** 下载完成后清理转存文件，避免长期占用管理员网盘容量。删除失败不影响本次下载，只记录日志。 */
export async function cleanupAliyunFile(env: Env, token: string): Promise<void> {
  const [driveId, fileId] = token.split(':')
  if (!driveId || !fileId) return
  try {
    const accessToken = await getValidAccessToken(env)
    await fetchJson(`${API_BASE}/v3/batch`, {
      method: 'POST',
      headers: aliyunHeaders(accessToken),
      body: JSON.stringify({
        requests: [
          {
            body: { drive_id: driveId, file_id: fileId },
            id: '0',
            method: 'POST',
            url: '/file/delete',
          },
        ],
        resource: 'file',
      }),
    })
  } catch (error) {
    console.error('[aliyun] 清理转存文件失败:', error instanceof Error ? error.message : error)
  }
}

/**
 * 阿里云盘的下载直链需要账号登录态才能签发，因此包装成走服务端代理下载的地址，
 * 令牌（driveId:fileId）留在服务端解析，不会暴露真实 Authorization 给访客。
 */
export function buildAliyunProxyLink(token: string, fileName?: string): string {
  const params = new URLSearchParams({ token })
  if (fileName) {
    params.set('name', fileName)
  }
  return `/api/aliyun-download?${params.toString()}`
}
