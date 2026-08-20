import { fetchJson } from './shared/http'
import type { ParsedFile, ParserContext } from './shared/types'
import { ParseError } from './shared/types'

const API_BASE = 'https://www.123pan.cn/b/api'
const SITE_BASE = 'https://www.123pan.cn'
const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const APP_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36'

interface Pan123File {
  FileId: string | number
  FileName: string
  Size: number
  Etag: string
  S3KeyFlag: string
  Type: number
}

interface ShareInfoResp {
  code: number
  message?: string
  data?: { InfoList: Pan123File[] }
}

interface DownloadInfoResp {
  code: number
  message?: string
  data?: { DownloadUrl?: string; DownloadURL?: string }
}

/**
 * 123云盘新版分享链接格式为 {userId}.share.123pan.cn/123pan/{shareKey}，
 * 旧版为 www.123pan.com/s/{shareKey}，两种路径段（s / 123pan）都要兼容。
 */
function extractShareKey(url: string): string | null {
  const match = url.match(/123pan\.(?:com|cn)\/(?:s|123pan)\/([A-Za-z0-9_-]+)/)
  return match ? match[1] : null
}

/**
 * 123云盘解析。仅支持公开分享的普通文件，需要登录/付费认证才能下载的文件暂不支持。
 * 官方接口在 2024 年迁移到了 www.123pan.cn/b/api，旧版 www.123pan.com/api 已失效。
 */
export async function parsePan123(ctx: ParserContext): Promise<ParsedFile> {
  const { url, pwd } = ctx
  const shareKey = extractShareKey(url)
  if (!shareKey) {
    throw new ParseError('无法识别123云盘分享链接格式')
  }

  const shareUrl = `${SITE_BASE}/s/${shareKey}`
  const infoUrl =
    `${API_BASE}/share/get?limit=100&next=1&orderBy=share_id&orderDirection=desc` +
    `&shareKey=${encodeURIComponent(shareKey)}&SharePwd=${encodeURIComponent(pwd ?? '')}&ParentFileId=0&Page=1`

  const info = await fetchJson<ShareInfoResp>(infoUrl, {
    headers: {
      'User-Agent': WEB_UA,
      Platform: 'web',
      Accept: 'application/json, text/plain, */*',
      Referer: shareUrl,
      Origin: SITE_BASE,
    },
  })

  const files = info.data?.InfoList ?? []
  if (info.code !== 0 || !files.length) {
    throw new ParseError(info.message ?? '123云盘分享信息获取失败，链接可能已失效或提取码错误')
  }

  const file = files.find((item) => item.Type === 0) ?? files[0]
  const downloadUrl = await resolvePan123Download(shareKey, shareUrl, file, pwd)

  return {
    panType: 'pan123',
    panName: '123云盘',
    fileName: file.FileName,
    fileSize: String(file.Size),
    directLink: downloadUrl,
  }
}

/**
 * 123云盘下载接口对 App 端/Web 端的校验规则不完全一致，参考官方客户端行为，
 * 依次尝试 App 无 Token、Web 无 Token 两种请求方式，尽量提高匿名下载的成功率。
 * 如果所有方式都返回“需要登录/付费”（code 5112），说明该文件本身被平台限制匿名下载，
 * 并非请求方式的问题。
 */
async function resolvePan123Download(
  shareKey: string,
  shareUrl: string,
  file: Pan123File,
  pwd?: string,
): Promise<string> {
  const body = JSON.stringify({
    ShareKey: shareKey,
    SharePwd: pwd ?? '',
    FileID: file.FileId,
    S3keyFlag: file.S3KeyFlag,
    Etag: file.Etag,
    Size: file.Size,
  })

  const attempts: Array<{ headers: Record<string, string> }> = [
    {
      headers: {
        'User-Agent': APP_UA,
        Referer: `${SITE_BASE}/`,
        Origin: SITE_BASE,
      },
    },
    {
      headers: {
        'User-Agent': WEB_UA,
        Platform: 'web',
        Accept: 'application/json, text/plain, */*',
        Referer: shareUrl,
        Origin: SITE_BASE,
      },
    },
  ]

  let lastRes: DownloadInfoResp | undefined
  for (const attempt of attempts) {
    const res = await fetchJson<DownloadInfoResp>(`${API_BASE}/share/download/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', ...attempt.headers },
      body,
    })
    lastRes = res
    const link = res.data?.DownloadUrl || res.data?.DownloadURL
    if (res.code === 0 && link) {
      return link
    }
  }

  if (lastRes?.code === 5112) {
    throw new ParseError('该文件需要登录123云盘账号或付费后才能下载，暂不支持匿名解析')
  }
  throw new ParseError(lastRes?.message ?? '123云盘解析失败，该文件可能需要登录认证才能下载')
}
