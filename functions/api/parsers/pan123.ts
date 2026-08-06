import { fetchJson } from './shared/http'
import type { ParsedFile, ParserContext } from './shared/types'
import { ParseError } from './shared/types'

interface Pan123File {
  FileId: string
  FileName: string
  Size: number
  Etag: string
  S3KeyFlag: string
  Type: number
}

interface ShareInfoResp {
  code: number
  message?: string
  data?: { List: Pan123File[] }
}

interface DownloadInfoResp {
  code: number
  message?: string
  data?: { DownloadUrl: string }
}

/**
 * 123云盘解析。仅支持公开分享的普通文件，大文件/需登录场景暂不支持
 * （对应官方 README 里说明的"仅建议本地部署使用"限制）。
 */
export async function parsePan123(ctx: ParserContext): Promise<ParsedFile> {
  const { url, pwd } = ctx
  const shareKeyMatch = url.match(/123(?:pan)?\.(?:com|cn)\/s\/([A-Za-z0-9-]+)/)
  if (!shareKeyMatch) {
    throw new ParseError('无法识别123云盘分享链接格式')
  }
  const shareKey = shareKeyMatch[1]

  const infoUrl = `https://www.123pan.com/api/share/info?shareKey=${shareKey}${
    pwd ? `&SharePwd=${encodeURIComponent(pwd)}` : ''
  }`
  const info = await fetchJson<ShareInfoResp>(infoUrl, { headers: { platform: 'web', Referer: url } })

  if (info.code !== 0 || !info.data?.List?.length) {
    throw new ParseError(info.message ?? '123云盘分享信息获取失败，链接可能已失效或提取码错误')
  }

  const file = info.data.List.find((item) => item.Type === 0) ?? info.data.List[0]

  const downloadRes = await fetchJson<DownloadInfoResp>('https://www.123pan.com/api/share/download/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', platform: 'web', Referer: url },
    body: JSON.stringify({
      ShareKey: shareKey,
      SharePwd: pwd ?? '',
      FileId: file.FileId,
      S3KeyFlag: file.S3KeyFlag,
      Etag: file.Etag,
      Size: file.Size,
    }),
  })

  if (downloadRes.code !== 0 || !downloadRes.data?.DownloadUrl) {
    throw new ParseError(downloadRes.message ?? '123云盘解析失败，该文件可能需要登录认证才能下载')
  }

  return {
    panType: 'pan123',
    panName: '123云盘',
    fileName: file.FileName,
    fileSize: String(file.Size),
    directLink: downloadRes.data.DownloadUrl,
  }
}
