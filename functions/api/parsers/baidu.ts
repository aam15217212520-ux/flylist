import { fetchJson } from './shared/http'
import type { ParsedFile, ParsedFolder, ParserContext } from './shared/types'
import { ParseError } from './shared/types'
import { getSiteConfig } from './shared/config'

interface WxListItem {
  isdir: number | string
  server_filename: string
  fs_id: number | string
  size?: number | string
  path: string
}

interface WxListResp {
  errno: number
  errtype?: number | string
  show_msg?: string
  data?: {
    uk: number | string
    shareid: number | string
    seckey: string
    list?: WxListItem[]
  }
}

interface TplConfigResp {
  errno: number
  data?: { sign: string; timestamp: number | string }
}

interface ShareDownloadResp {
  errno: number
  list?: Array<{
    dlink?: string
    server_filename?: string
    size?: number | string
    path?: string
  }>
}

const LIST_ERROR_MESSAGES: Record<string, string> = {
  mis_105: '你所解析的文件不存在',
  mispw_9: '提取码错误',
  'mispwd-9': '提取码错误',
  mis_2: '不存在此目录',
  mis_4: '不存在此目录',
  '5': '不存在此分享链接或提取码错误',
  '3': '该分享内容可能涉及侵权、色情等信息，无法访问',
  '0': '分享的文件已被删除',
  '10': '该分享已过期',
  '8001': '账号可能被限制，请在后台检查百度网盘账号状态',
  '9013': '账号被限制，请在后台检查百度网盘账号状态',
  '9019': '账号 Cookie 状态异常，请在后台重新配置 BDUSS',
}

const DOWNLOAD_ERROR_MESSAGES: Record<string, string> = {
  '999': '请求百度网盘服务器出错，请稍后重试',
  '-20': '触发验证码，请稍后再试',
  '-9': '文件不存在，请重新解析',
  '-6': '账号未登录，请在后台检查百度网盘账号状态',
  '-1': '该文件涉及违规内容，无法下载',
  '2': '下载失败，请稍后重试',
  '112': '解析已超时（签名 5 分钟内有效），请重新解析',
  '113': '传参错误，请重新解析',
  '116': '该分享不存在',
  '118': '没有下载权限，请在后台检查百度网盘账号 Cookie 是否有效',
  '110': '百度网盘服务器错误，可能是服务器 IP 被封禁',
  '121': '选择的文件过多，请减少后重试',
  '8001': '账号可能被限制，请在后台检查百度网盘账号状态',
  '9013': '账号被限制，请在后台检查百度网盘账号状态',
  '9019': '账号 Cookie 状态异常，请在后台重新配置 BDUSS',
}

function mapListError(res: WxListResp): string {
  const code = String(res.errtype ?? res.errno ?? 999)
  return LIST_ERROR_MESSAGES[code] ?? `百度网盘获取文件列表失败（错误码 ${code}），链接可能已失效或提取码不正确`
}

function mapDownloadError(errno?: number): string {
  const code = String(errno ?? 999)
  return DOWNLOAD_ERROR_MESSAGES[code] ?? `百度网盘获取下载链接失败（错误码 ${code}）`
}

/** URL-safe base64 转标准 base64，百度网盘 seckey 专用编码 */
function decodeSecKey(seckey: string): string {
  return seckey.replace(/-/g, '+').replace(/~/g, '=').replace(/_/g, '/')
}

function extractSurl(url: string): string | null {
  const match = url.match(/\/s\/([A-Za-z0-9_-]+)/)
  return match ? match[1] : null
}

/**
 * 百度网盘解析。
 *
 * 参考 codehub666/94list、HkList/HkList-laravel、yuantuo666/baiduwp-php 等开源实现，
 * 核心走官方微信端接口，不依赖分享页 HTML 结构：
 *   1) share/wxlist   —— 用 shorturl(+dir)+提取码 换取文件/文件夹列表，附带 uk/shareid/seckey
 *   2) share/tplconfig —— 用 shareid+uk 换取 sign/timestamp（下载签名，5分钟内有效）
 *   3) api/sharedownload —— 用 sign/timestamp + sekey(由 seckey 解码而来) + fs_id 换取真实下载直链
 *
 * 之前的实现漏传了 sekey 参数，是导致"登录态已过期"报错的真正原因（对应百度错误码118：
 * 没有下载权限，未传入 sekey 参数或参数错误），而不是 Cookie 本身失效。
 */
export async function parseBaidu(ctx: ParserContext): Promise<ParsedFile | ParsedFolder> {
  const { url, pwd, env } = ctx
  const config = await getSiteConfig(env)
  const baidu = config.baidu

  if (!baidu?.bduss) {
    throw new ParseError('管理员尚未在后台配置百度网盘账号，暂不支持解析')
  }
  const cookie = `BDUSS=${baidu.bduss};`

  const surl = extractSurl(url)
  if (!surl) {
    throw new ParseError('无法识别百度网盘分享链接格式')
  }

  let dir = ''
  let fsId = ''
  try {
    const parsed = new URL(url)
    dir = parsed.searchParams.get('__bdir') ?? ''
    fsId = parsed.searchParams.get('__bfsid') ?? ''
  } catch {
    // 忽略，按根目录处理
  }

  const { uk, shareid, seckey, list } = await fetchWxList(surl, fsId ? '' : dir, cookie, pwd ?? '')

  if (fsId) {
    const target = list.find((item) => String(item.fs_id) === fsId)
    return await resolveDownload(cookie, uk, shareid, seckey, fsId, target?.server_filename)
  }

  const isRoot = dir === ''
  const files = list.filter((item) => Number(item.isdir) === 0)
  const folders = list.filter((item) => Number(item.isdir) === 1)

  // 根目录且只有单个文件：直接返回直链，不需要访客再多点一次
  if (isRoot && files.length === 1 && folders.length === 0) {
    const only = files[0]
    return await resolveDownload(cookie, uk, shareid, seckey, String(only.fs_id), only.server_filename)
  }

  const folderItems: ParsedFolder['files'] = []
  for (const item of folders) {
    folderItems.push({
      fileId: `dir-${item.path}`,
      fileName: `📁 ${item.server_filename}`,
      url: `https://pan.baidu.com/s/${surl}?__bdir=${encodeURIComponent(item.path)}`,
    })
  }
  for (const item of files) {
    folderItems.push({
      fileId: String(item.fs_id),
      fileName: item.server_filename,
      fileSize: item.size !== undefined ? String(item.size) : undefined,
      url: `https://pan.baidu.com/s/${surl}?__bfsid=${item.fs_id}`,
    })
  }

  if (folderItems.length === 0) {
    throw new ParseError('该分享目录下没有文件')
  }

  return {
    panType: 'baidu',
    panName: '百度网盘',
    files: folderItems,
  }
}

async function fetchWxList(
  surl: string,
  dir: string,
  cookie: string,
  pwd: string,
): Promise<{ uk: string; shareid: string; seckey: string; list: WxListItem[] }> {
  const isRoot = dir === ''
  const body = new URLSearchParams({
    shorturl: surl,
    dir,
    root: isRoot ? '1' : '0',
    pwd,
    page: '1',
    num: '1000',
    order: 'time',
  }).toString()

  const res = await fetch(
    'https://pan.baidu.com/share/wxlist?channel=weixin&version=2.2.2&clienttype=25&web=1&qq-pf-to=pcqq.c2c',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'netdisk',
        Cookie: cookie,
        Referer: 'https://pan.baidu.com/disk/home',
      },
      body,
    },
  )

  // fs_id 是超大整数，标准 JSON.parse 会丢失精度，需要先把裸整数转成字符串再解析
  const rawText = await res.text()
  const safeText = rawText.replace(/"fs_id":(\d+)/g, '"fs_id":"$1"')

  let data: WxListResp
  try {
    data = JSON.parse(safeText) as WxListResp
  } catch {
    throw new ParseError('百度网盘返回数据异常，链接可能已失效')
  }

  if (data.errno !== 0 || !data.data) {
    throw new ParseError(mapListError(data))
  }

  return {
    uk: String(data.data.uk),
    shareid: String(data.data.shareid),
    seckey: data.data.seckey,
    list: data.data.list ?? [],
  }
}

async function fetchSign(cookie: string, uk: string, shareid: string): Promise<{ sign: string; timestamp: string }> {
  const res = await fetchJson<TplConfigResp>(
    `https://pan.baidu.com/share/tplconfig?shareid=${shareid}&uk=${uk}&fields=sign,timestamp&channel=chunlei&web=1&app_id=250528&clienttype=0`,
    {
      headers: {
        'User-Agent': 'netdisk;pan.baidu.com',
        Cookie: cookie,
        Referer: 'https://pan.baidu.com/disk/home',
      },
    },
  )

  if (res.errno !== 0 || !res.data?.sign || !res.data?.timestamp) {
    throw new ParseError('未能获取百度网盘下载签名，账号 Cookie 可能已失效，请在后台更新 BDUSS')
  }

  return { sign: res.data.sign, timestamp: String(res.data.timestamp) }
}

async function resolveDownload(
  cookie: string,
  uk: string,
  shareid: string,
  seckey: string,
  fsId: string,
  fallbackName?: string,
): Promise<ParsedFile> {
  const { sign, timestamp } = await fetchSign(cookie, uk, shareid)
  const randsk = decodeSecKey(seckey)

  const downloadRes = await fetchJson<ShareDownloadResp>(
    `https://pan.baidu.com/api/sharedownload?app_id=250528&channel=chunlei&clienttype=12&sign=${encodeURIComponent(sign)}&timestamp=${timestamp}&web=1`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
        Referer: 'https://pan.baidu.com/disk/home',
      },
      body: new URLSearchParams({
        encrypt: '0',
        extra: JSON.stringify({ sekey: randsk }),
        fid_list: `[${fsId}]`,
        primaryid: shareid,
        uk,
        product: 'share',
        type: 'nolimit',
      }).toString(),
    },
  )

  const file = downloadRes.list?.[0]
  if (downloadRes.errno !== 0 || !file?.dlink) {
    throw new ParseError(mapDownloadError(downloadRes.errno))
  }

  return {
    panType: 'baidu',
    panName: '百度网盘',
    fileName: file.server_filename ?? fallbackName,
    fileSize: file.size !== undefined ? String(file.size) : undefined,
    directLink: file.dlink,
  }
}

