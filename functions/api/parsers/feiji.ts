import { fetchJson } from './shared/http'
import type { ParsedFile, ParserContext } from './shared/types'
import { ParseError } from './shared/types'

interface ShareInfoResp {
  code: number
  msg?: string
  data?: { fileId: string; fileName: string; size: string }
}

interface DownloadResp {
  code: number
  msg?: string
  data?: { downloadUrl: string }
}

/**
 * 小飞机网盘 (feijipan.com / feijix.com) 解析。
 * 该网盘是较新的服务，接口路径以此为初版实现，如上线后解析失败，
 * 大概率是接口路径或字段名有变化，需要重新确认。
 */
export async function parseFeiji(ctx: ParserContext): Promise<ParsedFile> {
  const { url, pwd } = ctx
  const shareKeyMatch = url.match(/\/s\/([A-Za-z0-9]+)/)
  if (!shareKeyMatch) {
    throw new ParseError('无法识别小飞机网盘分享链接格式')
  }
  const shareKey = shareKeyMatch[1]

  const infoUrl = `https://api.feijipan.com/api/v1/share/info?code=${shareKey}${
    pwd ? `&pwd=${encodeURIComponent(pwd)}` : ''
  }`

  const info = await fetchJson<ShareInfoResp>(infoUrl, { headers: { Referer: url } })
  if (info.code !== 0 || !info.data) {
    throw new ParseError(info.msg ?? '小飞机网盘解析失败，分享链接可能已失效')
  }

  const downloadRes = await fetchJson<DownloadResp>('https://api.feijipan.com/api/v1/share/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: url },
    body: JSON.stringify({ code: shareKey, pwd: pwd ?? '', fileId: info.data.fileId }),
  })

  if (downloadRes.code !== 0 || !downloadRes.data) {
    throw new ParseError(downloadRes.msg ?? '小飞机网盘解析失败，无法获取直链')
  }

  return {
    panType: 'feiji',
    panName: '小飞机网盘',
    fileName: info.data.fileName,
    fileSize: info.data.size,
    directLink: downloadRes.data.downloadUrl,
  }
}
