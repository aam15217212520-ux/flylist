import { fetchJson } from './shared/http'
import type { Env, ParsedFile, ParsedFolder, ParserContext } from './shared/types'
import { ParseError } from './shared/types'
import { getSiteConfig, saveSiteConfig } from './shared/config'

const PORTAL_BASE = 'https://cloud.189.cn/api'
const OPEN_BASE = 'https://api.cloud.189.cn/open'
const APP_KEY = '600100422'
const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const REFERER = 'https://cloud.189.cn/web/main/file/folder/-11'

/** 天翼云盘网页端接口用的简单 MD5 签名：md5("600100422" + timestamp + "1") */
async function md5(str: string): Promise<string> {
  const data = new TextEncoder().encode(str)
  const digest = await crypto.subtle.digest('MD5', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Open API 用的签名：md5(拼接后的字符串)，取十六进制结果再当十进制大整数转回十六进制（Java BigInteger 习惯写法） */
async function javaMd5(str: string): Promise<string> {
  // 注意：不能用 BigInt('0x' + hex).toString(16) 模拟，那样会丢失十六进制字符串开头的 0
  // （BigInt 是数值运算，0x0abc 和 0xabc 数值相等，但字符串长度不同），导致签名间歇性不匹配
  return md5(str)
}

function cookieHeader(cookieLoginUser: string, sson?: string): string {
  let cookie = `COOKIE_LOGIN_USER=${cookieLoginUser}`
  if (sson) cookie += `; SSON=${sson}`
  return cookie
}

interface UserBriefResp {
  res_code?: number | string
  sessionKey?: string
}

/** 用后台配置的 COOKIE_LOGIN_USER 换取网页版 sessionKey，用于下一步换取 openAccessToken */
async function getWebSessionKey(cookieLoginUser: string, sson?: string): Promise<string> {
  const timestamp = String(Date.now())
  const signature = await md5(`${APP_KEY}${timestamp}1`)
  const resp = await fetchJson<UserBriefResp>(
    `${PORTAL_BASE}/portal/v2/getUserBriefInfo.action?noCache=${Math.random()}`,
    {
      headers: {
        'User-Agent': WEB_UA,
        Accept: 'application/json;charset=UTF-8',
        appkey: APP_KEY,
        'sign-type': '1',
        signature,
        timestamp,
        Referer: REFERER,
        Cookie: cookieHeader(cookieLoginUser, sson),
      },
    },
  )
  if (!resp.sessionKey) {
    throw new ParseError('天翼云盘账号登录态已失效，请在后台重新配置 COOKIE_LOGIN_USER')
  }
  return resp.sessionKey
}

interface AccessTokenResp {
  accessToken?: string
  expiresIn?: number
  errorCode?: string
}

/** 用 sessionKey 换取 openAccessToken（有效期较长，几十天量级），供 Open API 使用 */
async function getOpenAccessToken(sessionKey: string): Promise<{ token: string; expiresAt: number }> {
  const resp = await fetchJson<AccessTokenResp>(
    `${PORTAL_BASE}/open/oauth2/getAccessTokenBySsKey.action?noCache=${Math.random()}&sessionKey=${sessionKey}`,
    {
      headers: {
        'User-Agent': WEB_UA,
        Accept: 'application/json;charset=UTF-8',
        appkey: APP_KEY,
        Referer: REFERER,
      },
    },
  )
  if (!resp.accessToken) {
    throw new ParseError(`天翼云盘获取访问令牌失败，账号登录态可能已失效（${JSON.stringify(resp)}）`)
  }
  // expiresIn 返回的是绝对时间戳（毫秒），不是有效期秒数
  return { token: resp.accessToken, expiresAt: resp.expiresIn ?? Date.now() + 24 * 3600 * 1000 }
}

/** 获取一个可用的 openAccessToken：缓存未过期就直接用，否则重新走 sessionKey 换取流程 */
async function getValidAccessToken(env: Env): Promise<string> {
  const config = await getSiteConfig(env)
  const cloud189 = config.cloud189
  if (!cloud189?.cookieLoginUser) {
    throw new ParseError('管理员尚未在后台配置天翼云盘账号，暂不支持解析')
  }
  if (cloud189.openAccessToken && (cloud189.openAccessTokenExpiresAt ?? 0) > Date.now() + 60_000) {
    return cloud189.openAccessToken
  }

  let sessionKey: string
  try {
    sessionKey = await getWebSessionKey(cloud189.cookieLoginUser, cloud189.sson)
  } catch (error) {
    config.cloud189 = {
      ...cloud189,
      lastAccessTokenError: `sessionKey: ${error instanceof Error ? error.message : String(error)}`,
    }
    await saveSiteConfig(env, config)
    throw error
  }

  let token: string
  let expiresAt: number
  try {
    const result = await getOpenAccessToken(sessionKey)
    token = result.token
    expiresAt = result.expiresAt
  } catch (error) {
    config.cloud189 = {
      ...cloud189,
      lastAccessTokenError: `accessToken: ${error instanceof Error ? error.message : String(error)}`,
    }
    await saveSiteConfig(env, config)
    throw error
  }

  config.cloud189 = {
    ...cloud189,
    openAccessToken: token,
    openAccessTokenExpiresAt: expiresAt,
    updatedAt: Date.now(),
    lastAccessTokenError: undefined,
  }
  await saveSiteConfig(env, config)
  return token
}

function extractShareCode(url: string): string | null {
  const patterns = [
    /cloud\.189\.cn\/web\/share\?.*code=([a-zA-Z0-9]+)/i,
    /cloud\.189\.cn\/t\/([a-zA-Z0-9]+)/i,
    /h5\.cloud\.189\.cn\/t\/([a-zA-Z0-9]+)/i,
    /m\.cloud\.189\.cn\/t\/([a-zA-Z0-9]+)/i,
    /cloud\.189\.cn\/s\/([a-zA-Z0-9_-]+)/i,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  try {
    const code = new URL(url).searchParams.get('code')
    if (code && code.length > 5) return code
  } catch {
    // 忽略，走下面的失败返回
  }
  return null
}

interface ShareInfoResp {
  res_code?: number | string
  fileId?: number | string
  fileName?: string
  fileSize?: number
  isFolder?: number | boolean
  isDirectory?: boolean
  shareId?: number | string
  shareMode?: number | string
  fileInfoAO?: {
    fileId?: number | string
    fileName?: string
    fileSize?: number
    isFolder?: number | boolean
    isDirectory?: boolean
    shareId?: number | string
  }
  res_message?: string
}

interface ShareInfo {
  fileId: string
  fileName: string
  fileSize: number
  isFolder: boolean
  shareId: string
  shareMode: string
}

async function getShareInfo(shareCode: string): Promise<ShareInfo | null> {
  const resp = await fetchJson<ShareInfoResp>(
    `https://api.cloud.189.cn/open/share/getShareInfoByCodeV2.action?shareCode=${encodeURIComponent(shareCode)}&noCache=${Math.random()}`,
    {
      headers: {
        'User-Agent': WEB_UA,
        Accept: 'application/json;charset=UTF-8',
        Referer: 'https://cloud.189.cn/',
      },
    },
  )

  const raw = resp.fileId ? resp : resp.fileInfoAO
  if (!raw?.fileId) return null

  return {
    fileId: String(raw.fileId),
    fileName: raw.fileName ?? '未知文件名',
    fileSize: raw.fileSize ?? 0,
    isFolder: raw.isFolder === 1 || raw.isFolder === true || raw.isDirectory === true,
    shareId: String(raw.shareId ?? ''),
    shareMode: String(resp.shareMode ?? '1'),
  }
}

interface CheckAccessCodeResp {
  res_code?: number | string
  shareId?: number | string
}

/** 验证提取码，成功后拿到本次会话真正可用的 shareId */
async function checkAccessCode(shareCode: string, accessCode: string): Promise<string | null> {
  const resp = await fetchJson<CheckAccessCodeResp>('https://api.cloud.189.cn/open/share/checkAccessCode.action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json;charset=UTF-8',
      'User-Agent': WEB_UA,
      Referer: 'https://cloud.189.cn/',
    },
    body: `shareCode=${encodeURIComponent(shareCode)}&accessCode=${encodeURIComponent(accessCode)}&validateCode=`,
  })
  if ((resp.res_code === 0 || resp.res_code === '0') && resp.shareId) {
    return String(resp.shareId)
  }
  return null
}

interface ListShareDirResp {
  res_code?: number | string
  res_message?: string
  fileListAO?: {
    folderList?: Array<{ id?: number | string; fileId?: number | string; name?: string; fileName?: string }>
    fileList?: Array<{
      id?: number | string
      fileId?: number | string
      name?: string
      fileName?: string
      size?: number
      fileSize?: number
      isFolder?: number | boolean
    }>
  }
}

interface Cloud189FileItem {
  fileId: string
  fileName: string
  fileSize: number
  isFolder: boolean
}

async function listShareDir(
  accessToken: string,
  shareId: string,
  folderId: string,
  shareMode: string,
  accessCode: string,
): Promise<Cloud189FileItem[]> {
  const timestamp = String(Date.now())
  const signData = `AccessToken=${accessToken}&Timestamp=${timestamp}&fileId=${folderId}&shareId=${shareId}`
  const signature = await javaMd5(signData)

  const params = new URLSearchParams({
    uuid: crypto.randomUUID(),
    shareId,
    fileId: folderId,
    shareMode,
    isFolder: 'true',
    iconOption: '5',
    pageSize: '200',
    pageNum: '1',
    accessCode,
    accesstoken: accessToken,
    'sign-type': '1',
    signature,
    timestamp,
  })

  const resp = await fetchJson<ListShareDirResp>(`${OPEN_BASE}/share/listShareDir.action?${params.toString()}`, {
    headers: { Accept: 'application/json;charset=UTF-8' },
  })

  if (resp.res_code !== 0 && resp.res_code !== '0') return []

  const items: Cloud189FileItem[] = []
  const folderList = resp.fileListAO?.folderList ?? []
  for (const item of folderList) {
    items.push({
      fileId: String(item.id ?? item.fileId ?? ''),
      fileName: item.name ?? item.fileName ?? '',
      fileSize: 0,
      isFolder: true,
    })
  }
  const fileList = resp.fileListAO?.fileList ?? []
  for (const item of fileList) {
    items.push({
      fileId: String(item.id ?? item.fileId ?? ''),
      fileName: item.name ?? item.fileName ?? '',
      fileSize: item.size ?? item.fileSize ?? 0,
      isFolder: item.isFolder === 1 || item.isFolder === true,
    })
  }
  return items
}

interface DownloadUrlResp {
  fileDownloadUrl?: string
  errorCode?: string
  res_message?: string
  errorMsg?: string
}

/** 用 Open API 的 dt=1+shareId 匿名分享下载模式签发下载直链，官方专为分享场景设计，不绑定请求方 IP */
async function getFileDownloadUrl(accessToken: string, fileId: string, shareId: string): Promise<string> {
  const timestamp = Date.now().toString()
  const signData = `AccessToken=${accessToken}&Timestamp=${timestamp}&dt=1&fileId=${fileId}&shareId=${shareId}`
  const signature = await javaMd5(signData)

  const resp = await fetchJson<DownloadUrlResp>(
    `${OPEN_BASE}/file/getFileDownloadUrl.action?fileId=${fileId}&dt=1&shareId=${shareId}`,
    {
      headers: {
        Accept: 'application/json;charset=UTF-8',
        accesstoken: accessToken,
        'sign-type': '1',
        signature,
        timestamp,
        origin: 'https://h5.cloud.189.cn',
        referer: 'https://h5.cloud.189.cn/',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36',
      },
    },
  )

  if (!resp.fileDownloadUrl) {
    throw new ParseError(resp.res_message ?? resp.errorMsg ?? '天翼云盘获取下载直链失败，链接可能已失效或提取码不正确')
  }
  let downloadUrl = resp.fileDownloadUrl.replace('&amp;', '&')
  if (!downloadUrl.startsWith('http')) {
    downloadUrl = `https:${downloadUrl}`
  }
  return downloadUrl
}

/**
 * 天翼云盘解析。天翼云盘 Open API 里的 dt=1 + shareId 模式是官方专门为“分享链接下载”设计的
 * 匿名下载通道，与百度网盘不同，不需要转存到自己网盘，也不需要保证签发和下载同一 IP，
 * 因此这里可以直接在解析阶段签发直链返回给访客，不用额外的下载代理。
 */
export async function parseCloud189(ctx: ParserContext): Promise<ParsedFile | ParsedFolder> {
  const { url, pwd, env } = ctx
  const shareCode = extractShareCode(url)
  if (!shareCode) {
    throw new ParseError('无法识别天翼云盘分享链接格式')
  }

  const accessToken = await getValidAccessToken(env)
  const shareInfo = await getShareInfo(shareCode)
  if (!shareInfo) {
    throw new ParseError('天翼云盘获取分享信息失败，链接可能已失效')
  }

  let shareId = shareInfo.shareId
  if (pwd?.trim()) {
    const verifiedShareId = await checkAccessCode(shareCode, pwd.trim())
    if (!verifiedShareId) {
      throw new ParseError('提取码错误或已过期')
    }
    shareId = verifiedShareId
  }

  let folderId = ''
  try {
    folderId = new URL(url).searchParams.get('__cdir') ?? ''
  } catch {
    // 忽略，按分享根节点处理
  }

  if (!shareInfo.isFolder && !folderId) {
    const downloadUrl = await getFileDownloadUrl(accessToken, shareInfo.fileId, shareId)
    return {
      panType: 'cloud189',
      panName: '天翼云盘',
      fileName: shareInfo.fileName,
      fileSize: shareInfo.fileSize ? String(shareInfo.fileSize) : undefined,
      directLink: downloadUrl,
    }
  }

  const currentFolderId = folderId || shareInfo.fileId
  const items = await listShareDir(accessToken, shareId, currentFolderId, shareInfo.shareMode, pwd?.trim() ?? '')
  if (!items.length) {
    throw new ParseError('该分享目录下没有文件')
  }

  const files = items.filter((item) => !item.isFolder)
  const folders = items.filter((item) => item.isFolder)

  if (!folderId && files.length === 1 && folders.length === 0) {
    const downloadUrl = await getFileDownloadUrl(accessToken, files[0].fileId, shareId)
    return {
      panType: 'cloud189',
      panName: '天翼云盘',
      fileName: files[0].fileName,
      fileSize: files[0].fileSize ? String(files[0].fileSize) : undefined,
      directLink: downloadUrl,
    }
  }

  const folderItems: ParsedFolder['files'] = []
  for (const item of folders) {
    folderItems.push({
      fileId: `dir-${item.fileId}`,
      fileName: `📁 ${item.fileName}`,
      url: `${url.split('?')[0]}?__cdir=${item.fileId}`,
    })
  }
  for (const item of files) {
    folderItems.push({
      fileId: item.fileId,
      fileName: item.fileName,
      fileSize: item.fileSize ? String(item.fileSize) : undefined,
      url: `${url.split('?')[0]}?__cdir=${currentFolderId}&__cfid=${item.fileId}`,
    })
  }

  const cfid = (() => {
    try {
      return new URL(url).searchParams.get('__cfid')
    } catch {
      return null
    }
  })()
  if (cfid) {
    const target = files.find((item) => item.fileId === cfid)
    if (!target) {
      throw new ParseError('未找到该文件，链接可能已失效')
    }
    const downloadUrl = await getFileDownloadUrl(accessToken, target.fileId, shareId)
    return {
      panType: 'cloud189',
      panName: '天翼云盘',
      fileName: target.fileName,
      fileSize: target.fileSize ? String(target.fileSize) : undefined,
      directLink: downloadUrl,
    }
  }

  return {
    panType: 'cloud189',
    panName: '天翼云盘',
    files: folderItems,
  }
}
