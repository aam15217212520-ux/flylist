import { fetchText, fetchJson, DEFAULT_UA } from './shared/http'
import type { ParsedFile, ParserContext } from './shared/types'
import { ParseError } from './shared/types'
import { getSiteConfig } from './shared/config'

interface YunDataFile {
  fs_id: number
  server_filename: string
  size: number
  isdir: number
}

interface YunData {
  errno?: number
  FILEINFO?: YunDataFile[]
  SHARE_ID?: string | number
  SHARE_UK?: string | number
  SIGN?: string
  TIMESTAMP?: number
}

interface VerifyResp {
  errno: number
  randsk?: string
}

interface ShareDownloadResp {
  errno: number
  list?: Array<{ dlink: string }>
}

function extractYunData(html: string): YunData | null {
  const match = html.match(/window\.yunData\s*=\s*(\{[\s\S]*?\});/)
  if (!match) return null
  try {
    return JSON.parse(match[1]) as YunData
  } catch {
    return null
  }
}

/**
 * 百度网盘解析：使用后台配置的 SVIP 账号登录态(BDUSS/STOKEN)代替访客
 * 换取官方分享接口的高速直链，访客无需登录、无需会员。
 *
 * 思路：先带 Cookie 请求分享页，页面内联的 window.yunData 里已经包含了
 * 百度官方计算好的 sign / timestamp / shareid / uk，直接原样透传给
 * /api/sharedownload 即可，不需要自己实现百度的签名算法。
 */
export async function parseBaidu(ctx: ParserContext): Promise<ParsedFile> {
  const { url, pwd, env } = ctx
  const config = await getSiteConfig(env)
  const baidu = config.baidu

  if (!baidu?.bduss) {
    throw new ParseError('管理员尚未在后台配置百度网盘账号，暂不支持解析')
  }

  let cookie = `BDUSS=${baidu.bduss}; STOKEN=${baidu.stoken ?? ''}`

  let html = await fetchText(url, {
    headers: { Cookie: cookie, Referer: 'https://pan.baidu.com/', 'User-Agent': DEFAULT_UA },
  })

  if (/请输入提取码|访问密码/.test(html)) {
    if (!pwd) {
      throw new ParseError('该分享需要提取码')
    }
    const surlMatch = url.match(/pan\.baidu\.com\/s\/1?([A-Za-z0-9_-]+)/)
    const surl = surlMatch ? surlMatch[1] : ''

    const verify = await fetchJson<VerifyResp>(
      `https://pan.baidu.com/share/verify?surl=${surl}&pwd=${encodeURIComponent(pwd)}&t=${Date.now()}&channel=chunlei&web=1&clienttype=0`,
      { headers: { Cookie: cookie, Referer: url } },
    )

    if (verify.errno !== 0 || !verify.randsk) {
      throw new ParseError('提取码错误或分享链接已失效')
    }

    cookie = `${cookie}; BDCLND=${verify.randsk}`
    html = await fetchText(url, { headers: { Cookie: cookie, Referer: 'https://pan.baidu.com/' } })
  }

  const yunData = extractYunData(html)
  if (!yunData || yunData.errno) {
    throw new ParseError('未能读取百度网盘分享信息，链接可能已失效或账号登录态已过期，请在后台更新 BDUSS/STOKEN')
  }

  const file = yunData.FILEINFO?.find((item) => item.isdir === 0)
  if (!file) {
    throw new ParseError('该分享暂无可直接下载的单文件（可能是文件夹分享），本期暂不支持')
  }

  if (!yunData.SIGN || !yunData.TIMESTAMP) {
    throw new ParseError('未能获取解析签名，百度网盘接口可能已调整')
  }

  const downloadRes = await fetchJson<ShareDownloadResp>(
    `https://pan.baidu.com/api/sharedownload?sign=${yunData.SIGN}&timestamp=${yunData.TIMESTAMP}&channel=chunlei&web=1&clienttype=0&app_id=250528`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, Referer: url },
      body: new URLSearchParams({
        fid_list: `[${file.fs_id}]`,
        uk: String(yunData.SHARE_UK ?? ''),
        primaryid: String(yunData.SHARE_ID ?? ''),
      }).toString(),
    },
  )

  const directLink = downloadRes.list?.[0]?.dlink
  if (downloadRes.errno !== 0 || !directLink) {
    throw new ParseError('百度网盘解析失败，可能是账号登录态已过期，请在后台更新 BDUSS/STOKEN')
  }

  return {
    panType: 'baidu',
    panName: '百度网盘',
    fileName: file.server_filename,
    fileSize: String(file.size),
    directLink,
  }
}
