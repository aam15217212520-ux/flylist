import { fetchJson } from './shared/http'
import type { Env, ParsedFile, ParsedFolder, ParserContext } from './shared/types'
import { ParseError } from './shared/types'
import { getSiteConfig } from './shared/config'

/**
 * UC网盘（drive.uc.cn）与夸克网盘同源，API 端点结构完全一致，只是域名和 pr 参数不同。
 * 阿里云系 quark_uc 家族的另一个实现，底层是同一套 cloud drive 服务。
 */
const API_BASE = 'https://pc-api.uc.cn/1/clouddrive'
const UC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) uc-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch'

function normalizeUcCookie(cookie: string): string {
  // 允许管理员粘贴时带上“uc:”标签；实际 HTTP Cookie 不能包含该前缀。
  return cookie.replace(/^\s*uc:\s*/i, '')
}

function ucHeaders(cookie: string): Record<string, string> {
  const normalizedCookie = normalizeUcCookie(cookie)
  return {
    'User-Agent': UC_UA,
    'Content-Type': 'application/json;charset=UTF-8',
    Referer: 'https://drive.uc.cn/',
    Origin: 'https://drive.uc.cn',
    Accept: 'application/json, text/plain, */*',
    Cookie: normalizedCookie,
  }
}

interface TokenResp {
  code?: number | string
  status?: number
  message?: string
  data?: {
    token_info?: { stoken?: string; title?: string }
    title?: string
  }
}

interface UcFileItem {
  fid: string
  file_name: string
  file?: boolean
  size?: number
  obj_category?: string
  share_fid_token?: string
}

interface DetailResp {
  code?: number | string
  status?: number
  message?: string
  data?: { list?: UcFileItem[]; title?: string }
}

interface DownloadResp {
  code?: number | string
  status?: number
  message?: string
  data?: Array<{ download_url?: string }>
}

/**
 * UC网盘解析。架构与夸克网盘完全一致（阿里系 quark_uc 同源），管理员需在后台配置一个
 * UC 账号的 Cookie，访客借用该 Cookie 完成解析。
 * 分享如果是文件夹，返回文件列表供访客逐级选择，通过 URL 上的 __udir 参数记录当前目录 fid。
 * 根目录只有单个文件、无子文件夹时直接返回下载令牌，无需访客再多点一次。
 */
export async function parseUc(ctx: ParserContext): Promise<ParsedFile | ParsedFolder> {
  const { url, pwd, env } = ctx
  const config = await getSiteConfig(env)
  const cookie = config.uc?.cookie

  if (!cookie) {
    throw new ParseError('管理员尚未在后台配置 UC 网盘账号，暂不支持解析')
  }

  const shareIdMatch = url.match(/(?:drive\.uc\.cn|pan\.uc\.cn)\/s\/([A-Za-z0-9]+)/)
  if (!shareIdMatch) {
    throw new ParseError('无法识别 UC 网盘分享链接格式')
  }
  const shareId = shareIdMatch[1]
  const headers = ucHeaders(cookie)

  let pdirFid = '0'
  try {
    pdirFid = new URL(url).searchParams.get('__udir') || '0'
  } catch {
    // 忽略，按根目录处理
  }

  // UC 的 stoken 获取端点跟夸克不同，夸克是 share/sharepage/token，UC 是 v2/detail（直接拿 stoken + title）
  const tokenRes = await fetchJson<TokenResp>(
    `${API_BASE}/share/sharepage/v2/detail?pr=UCBrowser&fr=pc`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ pwd_id: shareId, passcode: pwd ?? '' }),
    },
  )

  const code = tokenRes.code ?? tokenRes.status
  if (!isSuccess(code) || !tokenRes.data?.token_info?.stoken) {
    throw new ParseError(
      tokenRes.message ??
        'UC 网盘获取分享信息失败，可能是提取码错误、分享已失效，或账号 Cookie 已过期',
    )
  }
  const stoken = tokenRes.data.token_info.stoken

  const detailUrl =
    `${API_BASE}/share/sharepage/detail?pr=UCBrowser&fr=pc&pwd_id=${shareId}&stoken=${encodeURIComponent(stoken)}` +
    `&pdir_fid=${pdirFid}&force=0&_page=1&_size=100&_fetch_banner=1&_fetch_share=1&_fetch_total=1&_sort=file_type:asc,updated_at:desc`
  const detailRes = await fetchJson<DetailResp>(detailUrl, { headers })

  const detailCode = detailRes.code ?? detailRes.status
  const items = detailRes.data?.list ?? []
  if (!isSuccess(detailCode)) {
    throw new ParseError(detailRes.message ?? 'UC 网盘获取分享内容失败，链接可能已失效或提取码不正确')
  }
  if (!items.length) {
    throw new ParseError('该分享目录下没有文件')
  }

  const files = items.filter((item) => item.file)
  const folders = items.filter((item) => !item.file)

  if (pdirFid === '0' && files.length === 1 && folders.length === 0) {
    return resolveUcDownload(shareId, stoken, files[0])
  }

  const folderItems: ParsedFolder['files'] = []
  for (const item of folders) {
    folderItems.push({
      fileId: `dir-${item.fid}`,
      fileName: `📁 ${item.file_name}`,
      url: `https://drive.uc.cn/s/${shareId}?__udir=${item.fid}`,
    })
  }
  for (const item of files) {
    folderItems.push({
      fileId: item.fid,
      fileName: item.file_name,
      fileSize: item.size ? String(item.size) : undefined,
      url: `https://drive.uc.cn/s/${shareId}?__udir=${pdirFid}&__ufid=${item.fid}`,
    })
  }

  const ufid = (() => {
    try {
      return new URL(url).searchParams.get('__ufid')
    } catch {
      return null
    }
  })()
  if (ufid) {
    const target = files.find((item) => item.fid === ufid)
    if (!target) {
      throw new ParseError('未找到该文件，链接可能已失效')
    }
    return resolveUcDownload(shareId, stoken, target)
  }

  return {
    panType: 'uc',
    panName: 'UC 网盘',
    files: folderItems,
  }
}

interface UcDownloadToken {
  shareId: string
  stoken: string
  fid: string
  fidsToken?: string
}

/**
 * 生成解析结果时不直接调用 file/download 接口拿真实直链。UC CDN 直链的签名与签发 IP 绑定，
 * 签发和下载必须是同一个来源 IP，否则会被判定签名不符、返回 403（跟夸克网盘同一个限制）。
 * 这里只打包一个复合令牌，真正调用 file/download 现场签发直链的动作推迟到访客点击下载、
 * 命中 /api/uc-download 代理的那一刻才执行。
 */
function resolveUcDownload(shareId: string, stoken: string, file: UcFileItem): ParsedFile {
  const token: UcDownloadToken = {
    shareId,
    stoken,
    fid: file.fid,
    fidsToken: file.share_fid_token,
  }
  return {
    panType: 'uc',
    panName: 'UC 网盘',
    fileName: file.file_name,
    fileSize: file.size ? String(file.size) : undefined,
    directLink: JSON.stringify(token),
  }
}

/** 在"下载代理"这一次请求内现场调用 UC 接口签发下载直链并返回。 */
export async function resolveUcFinalUrl(env: Env, token: string): Promise<{ url: string; cookie: string }> {
  const config = await getSiteConfig(env)
  const cookie = config.uc?.cookie
  if (!cookie) {
    throw new Error('UC 网盘账号未配置')
  }

  let parsed: UcDownloadToken
  try {
    parsed = JSON.parse(token)
  } catch {
    throw new Error('链接参数无效，请重新解析')
  }

  const headers = ucHeaders(cookie)
  const downloadRes = await fetchJson<DownloadResp>(`${API_BASE}/file/download?pr=UCBrowser&fr=pc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fids: [parsed.fid],
      pwd_id: parsed.shareId,
      stoken: parsed.stoken,
      ...(parsed.fidsToken ? { fids_token: [parsed.fidsToken] } : {}),
    }),
  })

  const code = downloadRes.code ?? downloadRes.status
  const directLink = downloadRes.data?.[0]?.download_url
  if (!directLink) {
    throw new Error(downloadRes.message ?? 'UC 网盘获取下载直链失败，该文件可能超出分享直链限制，或链接已失效，请重新解析')
  }

  return { url: directLink, cookie: normalizeUcCookie(cookie) }
}

/**
 * UC 网盘的下载直链只有携带账号登录 Cookie 才能访问，因此包装成走服务端代理下载的地址，
 * 令牌（而非真实直链）全程留在服务端解析，不会暴露给访客。
 */
export function buildUcProxyLink(token: string, fileName?: string): string {
  const params = new URLSearchParams({ token })
  if (fileName) {
    params.set('name', fileName)
  }
  return `/api/uc-download?${params.toString()}`
}

function isSuccess(code: number | string | undefined): boolean {
  if (code === undefined) return true
  if (typeof code === 'string') return code === '0' || code === '200'
  return code === 0 || code === 200
}
