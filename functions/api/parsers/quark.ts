import { fetchJson } from './shared/http'
import type { ParsedFile, ParsedFolder, ParserContext } from './shared/types'
import { ParseError } from './shared/types'
import { getSiteConfig } from './shared/config'

const API_BASE = 'https://drive-pc.quark.cn/1/clouddrive'
const QUARK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch'

function quarkHeaders(cookie: string): Record<string, string> {
  return {
    'User-Agent': QUARK_UA,
    'Content-Type': 'application/json;charset=UTF-8',
    Referer: 'https://pan.quark.cn/',
    Origin: 'https://pan.quark.cn',
    Accept: 'application/json, text/plain, */*',
    Cookie: cookie,
  }
}

interface TokenResp {
  code: number
  message?: string
  data?: { stoken?: string }
}

interface QuarkFileItem {
  fid: string
  file_name: string
  file?: boolean
  size?: number
  obj_category?: string
  share_fid_token?: string
}

interface DetailResp {
  code: number
  message?: string
  data?: { list?: QuarkFileItem[] }
}

interface DownloadResp {
  code: number
  message?: string
  data?: Array<{ download_url?: string }>
}

/**
 * 夸克网盘解析。夸克官方接口要求登录态，必须由管理员在后台配置一个夸克账号的
 * Cookie，访客借用这个 Cookie 完成解析（跟百度网盘同一个模式）。
 * 仅支持普通分享直链，超出分享直链限制、需要转存到网盘再下载的大文件场景暂不支持。
 * 分享如果是文件夹（或包含子文件夹），返回文件列表供访客逐级选择，跟百度网盘同一个模式，
 * 通过 URL 上的 __qdir 参数记录当前浏览的目录 fid。
 */
export async function parseQuark(ctx: ParserContext): Promise<ParsedFile | ParsedFolder> {
  const { url, pwd, env } = ctx
  const config = await getSiteConfig(env)
  const cookie = config.quark?.cookie

  if (!cookie) {
    throw new ParseError('管理员尚未在后台配置夸克网盘账号，暂不支持解析')
  }

  const pwdIdMatch = url.match(/pan\.quark\.cn\/s\/([A-Za-z0-9]+)/)
  if (!pwdIdMatch) {
    throw new ParseError('无法识别夸克网盘分享链接格式')
  }
  const pwdId = pwdIdMatch[1]
  const headers = quarkHeaders(cookie)

  let pdirFid = '0'
  try {
    pdirFid = new URL(url).searchParams.get('__qdir') || '0'
  } catch {
    // 忽略，按根目录处理
  }

  const tokenRes = await fetchJson<TokenResp>(`${API_BASE}/share/sharepage/token?pr=ucpro&fr=pc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ pwd_id: pwdId, passcode: pwd ?? '' }),
  })

  if (tokenRes.code !== 0 || !tokenRes.data?.stoken) {
    throw new ParseError(
      tokenRes.message ?? '夸克网盘获取分享信息失败，可能是提取码错误、分享已失效，或账号 Cookie 已过期',
    )
  }
  const stoken = tokenRes.data.stoken

  const detailUrl =
    `${API_BASE}/share/sharepage/detail?pr=ucpro&fr=pc&pwd_id=${pwdId}&stoken=${encodeURIComponent(stoken)}` +
    `&pdir_fid=${pdirFid}&force=0&_page=1&_size=50&_fetch_banner=1&_fetch_share=1&_fetch_total=1&_sort=file_type:asc,updated_at:desc`
  const detailRes = await fetchJson<DetailResp>(detailUrl, { headers })

  const items = detailRes.data?.list ?? []
  if (detailRes.code !== 0) {
    throw new ParseError(detailRes.message ?? '夸克网盘获取分享内容失败，链接可能已失效或提取码不正确')
  }
  if (!items.length) {
    throw new ParseError('该分享目录下没有文件')
  }

  const files = items.filter((item) => item.file)
  const folders = items.filter((item) => !item.file)

  // 根目录且只有单个文件、没有子文件夹：直接返回直链，不需要访客再多点一次
  if (pdirFid === '0' && files.length === 1 && folders.length === 0) {
    return await resolveQuarkDownload(headers, pwdId, stoken, files[0])
  }

  const folderItems: ParsedFolder['files'] = []
  for (const item of folders) {
    folderItems.push({
      fileId: `dir-${item.fid}`,
      fileName: `📁 ${item.file_name}`,
      url: `https://pan.quark.cn/s/${pwdId}?__qdir=${item.fid}`,
    })
  }
  for (const item of files) {
    folderItems.push({
      fileId: item.fid,
      fileName: item.file_name,
      fileSize: item.size ? String(item.size) : undefined,
      url: `https://pan.quark.cn/s/${pwdId}?__qdir=${pdirFid}&__qfid=${item.fid}`,
    })
  }

  // 访客点了某个具体文件（而不是目录）：直接解析该文件的下载直链
  const qfid = (() => {
    try {
      return new URL(url).searchParams.get('__qfid')
    } catch {
      return null
    }
  })()
  if (qfid) {
    const target = files.find((item) => item.fid === qfid)
    if (!target) {
      throw new ParseError('未找到该文件，链接可能已失效')
    }
    return await resolveQuarkDownload(headers, pwdId, stoken, target)
  }

  return {
    panType: 'quark',
    panName: '夸克网盘',
    files: folderItems,
  }
}

async function resolveQuarkDownload(
  headers: Record<string, string>,
  pwdId: string,
  stoken: string,
  file: QuarkFileItem,
): Promise<ParsedFile> {
  const downloadRes = await fetchJson<DownloadResp>(`${API_BASE}/file/download?pr=ucpro&fr=pc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fids: [file.fid],
      pwd_id: pwdId,
      stoken,
      ...(file.share_fid_token ? { fids_token: [file.share_fid_token] } : {}),
    }),
  })

  const directLink = downloadRes.data?.[0]?.download_url
  if (downloadRes.code === 31001) {
    throw new ParseError('夸克网盘账号登录态已过期，请在后台更新 Cookie')
  }
  if (downloadRes.code !== 0 || !directLink) {
    throw new ParseError(downloadRes.message ?? '夸克网盘解析失败，该文件可能超出分享直链限制，需要登录网盘转存后下载')
  }

  return {
    panType: 'quark',
    panName: '夸克网盘',
    fileName: file.file_name,
    fileSize: file.size ? String(file.size) : undefined,
    directLink,
  }
}

/**
 * 夸克网盘的下载直链只有携带账号登录 Cookie 才能访问，不能直接交给用户浏览器，
 * 因此包装成走服务端代理下载的地址，Cookie 全程留在服务端，不会暴露给访客。
 */
export function buildQuarkProxyLink(rawDirectLink: string, fileName?: string): string {
  const params = new URLSearchParams({ u: rawDirectLink })
  if (fileName) {
    params.set('name', fileName)
  }
  return `/api/quark-download?${params.toString()}`
}
