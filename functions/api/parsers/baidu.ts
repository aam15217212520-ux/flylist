import { fetchJson } from './shared/http'
import type { ParsedFile, ParsedFolder, ParserContext, Env } from './shared/types'
import { ParseError } from './shared/types'
import type { BaiduAccount } from './shared/config'
import { getSiteConfig } from './shared/config'
import { pickBaiduAccount, markBaiduAccountUsed, markBaiduAccountFailed, markBaiduAccountDirReady } from './shared/baiduPool'

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

interface TemplateVarResp {
  errno: number
  result?: { bdstoken?: string }
}

interface ApiListResp {
  errno: number
  list?: Array<{ path: string; isdir: number | string }>
}

interface ApiCreateResp {
  errno: number
}

interface TransferResp {
  errno: number
  extra?: { list?: Array<{ to?: string; to_fs_id?: number | string }> }
}

interface ApiDownloadResp {
  errno: number
  list?: Array<{ dlink?: string }>
}

interface PcsLocateResp {
  error_code?: number
  errmsg?: string
  urls?: Array<{ url: string }>
}

const PARSE_DIR = '/parse_file'

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
  '8001': '账号可能被限制，请在后台检查百度网盘账号池状态',
  '9013': '账号被限制，请在后台检查百度网盘账号池状态',
  '9019': '账号 Cookie 状态异常，请在后台检查百度网盘账号池状态',
}

/** 账号自身状态异常导致的错误码，出现时应标记该账号失效并尝试换用账号池中的其他账号 */
const ACCOUNT_FAILURE_CODES = new Set(['8001', '9013', '9019', '-6', '118', '12'])

function mapListError(res: WxListResp): string {
  const code = String(res.errtype ?? res.errno ?? 999)
  return LIST_ERROR_MESSAGES[code] ?? `百度网盘获取文件列表失败（错误码 ${code}），链接可能已失效或提取码不正确`
}

/** URL-safe base64 转标准 base64，百度网盘 seckey 专用编码 */
function decodeSecKey(seckey: string): string {
  return seckey.replace(/-/g, '+').replace(/~/g, '=').replace(/_/g, '/')
}

function extractSurl(url: string): string | null {
  const match = url.match(/\/(?:s|e)\/([A-Za-z0-9_-]+)/)
  return match ? match[1] : null
}

function accountCookie(account: BaiduAccount): string {
  // 兼容旧数据：若没有存过完整 Cookie（不包含 '=' 多对的情况下），尝试当作纯BDUSS使用（效果有限，建议重新保存为完整 Cookie）
  const raw = account.cookie.trim()
  if (raw.includes('BDUSS=')) return raw.endsWith(';') ? raw : `${raw};`
  return `BDUSS=${raw};`
}

/**
 * 百度网盘解析（账号池 + 转存下载方案）。
 *
 * 之前直接调用 api/sharedownload 拿分享直链的方案，在百度侧稳定触发 9019 人机验证风控，
 * 经过与多个开源实现（f4team-cn/f4pan 等）交叉验证，风控只针对"匿名/分享场景直接下载"，
 * 而"账号下载自己网盘里的文件"风控要宽松得多。因此改为：
 *   1) share/wxlist       —— 拿文件列表 + uk/shareid/seckey（同旧版）
 *   2) api/list+api/create —— 确保账号自己网盘下存在 /parse_file 目录
 *   3) gettemplatevariable —— 拿账号自己的 bdstoken
 *   4) share/transfer      —— 把分享文件转存到账号自己的 /parse_file 目录
 *   5) api/download        —— 用账号自己的 cookie 下载"自己网盘里的文件"，拿到真实直链
 *      （若失败，回退到 f4pan 使用的 PCS locatedownload 接口作为兜底）
 *
 * 账号池：后台可配置多个百度账号，转存/下载失败时自动标记该账号失效并换下一个账号重试，
 * 避免单账号被限速/封禁后网站直接不可用。
 */
export async function parseBaidu(ctx: ParserContext): Promise<ParsedFile | ParsedFolder> {
  const { url, pwd, env } = ctx
  const config = await getSiteConfig(env)
  const accounts = config.baiduAccounts ?? []

  if (accounts.length === 0) {
    throw new ParseError('管理员尚未在后台配置百度网盘账号池，暂不支持解析')
  }

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

  const { uk, shareid, seckey, list } = await fetchWxListWithRetry(env, surl, fsId ? '' : dir, pwd ?? '')

  if (fsId) {
    const target = list.find((item) => String(item.fs_id) === fsId)
    return await resolveDownloadWithRetry(env, uk, shareid, seckey, fsId, surl, target?.server_filename)
  }

  const isRoot = dir === ''
  const files = list.filter((item) => Number(item.isdir) === 0)
  const folders = list.filter((item) => Number(item.isdir) === 1)

  // 根目录且只有单个文件：直接返回直链，不需要访客再多点一次
  if (isRoot && files.length === 1 && folders.length === 0) {
    const only = files[0]
    return await resolveDownloadWithRetry(env, uk, shareid, seckey, String(only.fs_id), surl, only.server_filename)
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

/** 拿文件列表阶段账号出问题（如 Cookie 失效）时换用账号池里的下一个账号重试 */
async function fetchWxListWithRetry(
  env: Env,
  surl: string,
  dir: string,
  pwd: string,
): Promise<{ uk: string; shareid: string; seckey: string; list: WxListItem[] }> {
  const triedIds = new Set<string>()
  const maxAttempts = (await getSiteConfig(env)).baiduAccounts?.length ?? 1

  for (let attempt = 0; attempt < Math.max(maxAttempts, 1); attempt++) {
    const account = await pickUntried(env, triedIds)
    if (!account) {
      throw new ParseError('没有可用的百度网盘账号，请在后台检查账号池状态')
    }
    triedIds.add(account.id)

    try {
      const result = await fetchWxList(surl, dir, accountCookie(account), pwd)
      await markBaiduAccountUsed(env, account.id)
      return result
    } catch (error) {
      if (error instanceof AccountFailure) {
        await markBaiduAccountFailed(env, account.id, error.message)
        continue
      }
      throw error
    }
  }

  throw new ParseError('账号池中所有账号均不可用，请在后台检查百度网盘账号池状态')
}

async function pickUntried(env: Env, triedIds: Set<string>): Promise<BaiduAccount | null> {
  const config = await getSiteConfig(env)
  const accounts = (config.baiduAccounts ?? []).filter((a) => a.status === 'normal' && !triedIds.has(a.id))
  if (accounts.length === 0) return null
  accounts.sort((a, b) => a.lastUsedAt - b.lastUsedAt)
  return accounts[0]
}

/** 标记"这是账号自身问题，应该换号重试"的内部错误 */
class AccountFailure extends Error {}

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
    const code = String(data.errtype ?? data.errno ?? 999)
    if (ACCOUNT_FAILURE_CODES.has(code)) {
      throw new AccountFailure(mapListError(data))
    }
    throw new ParseError(mapListError(data))
  }

  return {
    uk: String(data.data.uk),
    shareid: String(data.data.shareid),
    seckey: data.data.seckey,
    list: data.data.list ?? [],
  }
}

/** 转存+下载阶段账号出问题时换用账号池里的下一个账号重试 */
async function resolveDownloadWithRetry(
  env: Env,
  uk: string,
  shareid: string,
  seckey: string,
  fsId: string,
  surl: string,
  fallbackName?: string,
): Promise<ParsedFile> {
  const triedIds = new Set<string>()
  const maxAttempts = (await getSiteConfig(env)).baiduAccounts?.length ?? 1

  for (let attempt = 0; attempt < Math.max(maxAttempts, 1); attempt++) {
    const account = await pickUntried(env, triedIds)
    if (!account) {
      throw new ParseError('没有可用的百度网盘账号，请在后台检查账号池状态')
    }
    triedIds.add(account.id)

    try {
      const result = await resolveDownload(env, account, uk, shareid, seckey, fsId, surl, fallbackName)
      await markBaiduAccountUsed(env, account.id)
      return result
    } catch (error) {
      if (error instanceof AccountFailure) {
        await markBaiduAccountFailed(env, account.id, error.message)
        continue
      }
      throw error
    }
  }

  throw new ParseError('账号池中所有账号均转存/下载失败，请在后台检查百度网盘账号池状态')
}

async function getOwnBdsToken(cookie: string): Promise<string> {
  const res = await fetchJson<TemplateVarResp>(
    'https://pan.baidu.com/api/gettemplatevariable?clienttype=0&app_id=250528&web=1&fields=%5B%22bdstoken%22%2C%22token%22%2C%22uk%22%2C%22isdocuser%22%2C%22servertime%22%5D',
    { headers: { Cookie: cookie, Referer: 'https://pan.baidu.com/disk/home' } },
  )
  const token = res.result?.bdstoken
  if (res.errno !== 0 || !token) {
    throw new AccountFailure('账号 Cookie 已失效，无法获取 bdstoken')
  }
  return token
}

/** 确保账号自己网盘根目录下存在 /parse_file 目录，用于承接转存的文件 */
async function ensureParseDir(env: Env, account: BaiduAccount, cookie: string, bdstoken: string): Promise<void> {
  if (account.dirReady) return

  const listRes = await fetchJson<ApiListResp>(
    `https://pan.baidu.com/api/list?dir=%2F&order=name&desc=0&start=0&limit=500&web=1&app_id=250528&channel=chunlei&clienttype=0&bdstoken=${encodeURIComponent(bdstoken)}`,
    { headers: { Cookie: cookie, Referer: 'https://pan.baidu.com/disk/home' } },
  )

  const exists = listRes.list?.some((item) => item.path === PARSE_DIR && Number(item.isdir) === 1)
  if (exists) {
    await markBaiduAccountDirReady(env, account.id)
    return
  }

  const createRes = await fetchJson<ApiCreateResp>(
    `https://pan.baidu.com/api/create?a=commit&web=1&app_id=250528&channel=chunlei&clienttype=0&bdstoken=${encodeURIComponent(bdstoken)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
        Referer: 'https://pan.baidu.com/disk/home',
      },
      body: new URLSearchParams({
        path: PARSE_DIR,
        isdir: '1',
        size: '',
        block_list: '[]',
        method: 'post',
      }).toString(),
    },
  )

  if (createRes.errno !== 0) {
    throw new AccountFailure('无法在账号网盘下创建转存目录，账号可能异常')
  }
  await markBaiduAccountDirReady(env, account.id)
}

/** 把分享的文件转存到账号自己的 /parse_file 目录 */
async function transferToOwnDrive(
  cookie: string,
  shareid: string,
  uk: string,
  fsId: string,
  randsk: string,
  bdstoken: string,
  shareUrl: string,
): Promise<{ toPath: string; toFsId: string }> {
  const res = await fetchJson<TransferResp>(
    `https://pan.baidu.com/share/transfer?shareid=${shareid}&from=${uk}&sekey=${encodeURIComponent(randsk)}&ondup=newcopy&async=1&channel=chunlei&web=1&app_id=250528&bdstoken=${encodeURIComponent(bdstoken)}&clienttype=0`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
        Referer: shareUrl,
      },
      body: `fsidlist=%5B${fsId}%5D&path=${encodeURIComponent(PARSE_DIR)}&type=1`,
    },
  )

  // 9013/12：账号本身状态异常（限制/未登录），换号重试；2：目标已存在等业务错误，不换号但视为失败
  if (res.errno === 9013 || res.errno === 12) {
    throw new AccountFailure(`转存失败（错误码 ${res.errno}），账号可能被限制`)
  }

  const item = res.extra?.list?.[0]
  if (res.errno !== 0 || !item?.to_fs_id) {
    throw new ParseError(`转存文件失败（错误码 ${res.errno}），请检查账号可用空间`)
  }

  return { toPath: String(item.to), toFsId: String(item.to_fs_id) }
}

/** 优先走官方网页下载接口拿自己文件的直链；失败则回退到 f4pan 使用的 PCS 移动端接口 */
async function downloadOwnFile(cookie: string, toFsId: string, toPath: string, bdstoken: string): Promise<string> {
  try {
    const res = await fetchJson<ApiDownloadResp>(
      `https://pan.baidu.com/api/download?type=dlink&app_id=250528&channel=chunlei&web=1&clienttype=0&fidlist=%5B${toFsId}%5D&bdstoken=${encodeURIComponent(bdstoken)}`,
      { headers: { Cookie: cookie, Referer: 'https://pan.baidu.com/disk/home' } },
    )
    const dlink = res.list?.[0]?.dlink
    if (res.errno === 0 && dlink) {
      return dlink
    }
  } catch {
    // 忽略，走下面的兜底方案
  }

  // 兜底：f4pan 使用的 PCS 移动端下载接口（部分字段为其抓包得到的固定值，风险自负）
  const encodedPath = encodeURIComponent(toPath)
  const pcsUrl =
    `https://d.pcs.baidu.com/rest/2.0/pcs/file?ant=1&apn_id=33_13&app_id=250528&channel=0&check_blue=1` +
    `&clienttype=17&cuid=08E271F7046B366BE1BF9F1F30DF0689%7CVFZVYSRCU&deviceid=611777535803319847` +
    `&devuid=08E271F7046B366BE1BF9F1F30DF0689%7CVFZVYSRCU&dtype=1&eck=1&ehps=1&err_ver=1.0&es=1&esl=1` +
    `&freeisp=0&method=locatedownload&network_type=4G&path=${encodedPath}&queryfree=0` +
    `&rand=0854bec9ad10241680eb16aaf3e9ab3912f0f429&time=${Math.floor(Date.now() / 1000)}&use=0&ver=4.0` +
    `&version=2.2.101.242&version_app=12.25.3&vip=0&psign=aa42ffc322b4c71d2f39e422aa83607e`

  const pcsRes = await fetchJson<PcsLocateResp>(pcsUrl, {
    headers: { Cookie: cookie, Referer: 'https://pan.baidu.com/disk/home' },
  })

  const url = pcsRes.urls?.[0]?.url
  if (!url) {
    throw new ParseError(`获取下载直链失败：${pcsRes.errmsg ?? '未知错误'}`)
  }
  return `${url}&origin=dlna`
}

async function resolveDownload(
  env: Env,
  account: BaiduAccount,
  uk: string,
  shareid: string,
  seckey: string,
  fsId: string,
  surl: string,
  fallbackName?: string,
): Promise<ParsedFile> {
  const cookie = accountCookie(account)
  const bdstoken = await getOwnBdsToken(cookie)

  await ensureParseDir(env, account, cookie, bdstoken)

  const randsk = decodeSecKey(seckey)
  const { toPath, toFsId } = await transferToOwnDrive(
    cookie,
    shareid,
    uk,
    fsId,
    randsk,
    bdstoken,
    `https://pan.baidu.com/s/${surl}`,
  )

  const dlink = await downloadOwnFile(cookie, toFsId, toPath, bdstoken)

  return {
    panType: 'baidu',
    panName: '百度网盘',
    fileName: fallbackName,
    directLink: dlink,
  }
}
