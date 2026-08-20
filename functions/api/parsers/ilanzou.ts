import { DEFAULT_UA } from './shared/http'
import type { ParsedFile, ParsedFolder, ParserContext } from './shared/types'
import { ParseError } from './shared/types'

const AES_KEY = 'lanZouY-disk-app'

// ---- 阿里云WAF人机验证(acw_sc__v2)：置换 + 异或，纯计算即可复现，不需要跑浏览器 ----
// 蓝奏云优享版和蓝奏云共用同一套WAF，这里独立实现一份（不复用 lanzou.ts，避免改动其它网盘代码）
const ACW_POS_LIST = [
  15, 35, 29, 24, 33, 16, 1, 38, 10, 9, 19, 31, 40, 27, 22, 23, 25, 13, 6, 11, 39, 18, 20, 8, 14, 21, 32, 26, 2, 30, 7,
  4, 17, 5, 3, 28, 34, 37, 12, 36,
]
const ACW_MASK = '3000176000856006061501533003690027800375'

function solveAcwScV2(arg1: string): string {
  const outPutList: string[] = new Array(40).fill('')
  for (let i = 0; i < arg1.length; i++) {
    const ch = arg1[i]
    for (let j = 0; j < ACW_POS_LIST.length; j++) {
      if (ACW_POS_LIST[j] === i + 1) outPutList[j] = ch
    }
  }
  const arg2 = outPutList.join('')
  const length = Math.min(arg2.length, ACW_MASK.length)
  let result = ''
  for (let i = 0; i < length; i += 2) {
    const strVal = parseInt(arg2.substring(i, i + 2), 16)
    const maskVal = parseInt(ACW_MASK.substring(i, i + 2), 16)
    result += (strVal ^ maskVal).toString(16).padStart(2, '0')
  }
  return result
}

// ---- AES-128-ECB：蓝奏云优享版接口把时间戳/文件ID等参数用这个算法加密成hex后传给服务端 ----
// Web Crypto API 不直接支持 ECB 模式，只能手写实现（只需要加密，不需要解密）
const AES_S_BOX = [
  99, 124, 119, 123, 242, 107, 111, 197, 48, 1, 103, 43, 254, 215, 171, 118, 202, 130, 201, 125, 250, 89, 71, 240, 173,
  212, 162, 175, 156, 164, 114, 192, 183, 253, 147, 38, 54, 63, 247, 204, 52, 165, 229, 241, 113, 216, 49, 21, 4, 199,
  35, 195, 24, 150, 5, 154, 7, 18, 128, 226, 235, 39, 178, 117, 9, 131, 44, 26, 27, 110, 90, 160, 82, 59, 214, 179, 41,
  227, 47, 132, 83, 209, 0, 237, 32, 252, 177, 91, 106, 203, 190, 57, 74, 76, 88, 207, 208, 239, 170, 251, 67, 77, 51,
  133, 69, 249, 2, 127, 80, 60, 159, 168, 81, 163, 64, 143, 146, 157, 56, 245, 188, 182, 218, 33, 16, 255, 243, 210,
  205, 12, 19, 236, 95, 151, 68, 23, 196, 167, 126, 61, 100, 93, 25, 115, 96, 129, 79, 220, 34, 42, 144, 136, 70, 238,
  184, 20, 222, 94, 11, 219, 224, 50, 58, 10, 73, 6, 36, 92, 194, 211, 172, 98, 145, 149, 228, 121, 231, 200, 55, 109,
  141, 213, 78, 169, 108, 86, 244, 234, 101, 122, 174, 8, 186, 120, 37, 46, 28, 166, 180, 198, 232, 221, 116, 31, 75,
  189, 139, 138, 112, 62, 181, 102, 72, 3, 246, 14, 97, 53, 87, 185, 134, 193, 29, 158, 225, 248, 152, 17, 105, 217,
  142, 148, 155, 30, 135, 233, 206, 85, 40, 223, 140, 161, 137, 13, 191, 230, 66, 104, 65, 153, 45, 15, 176, 84, 187,
  22,
]
const AES_RCON = [1, 2, 4, 8, 16, 32, 64, 128, 27, 54]

class AES128ECB {
  private key = new Uint8Array(16)

  constructor(keyStr: string) {
    const keyBytes = new TextEncoder().encode(keyStr)
    this.key.set(keyBytes.slice(0, 16))
  }

  private gmul(a: number, b: number): number {
    let p = 0
    for (let i = 0; i < 8; i++) {
      if ((b & 1) !== 0) p ^= a
      const hiBitSet = (a & 128) !== 0
      a = (a << 1) & 0xff
      if (hiBitSet) a ^= 27
      b >>= 1
    }
    return p & 255
  }

  private subBytes(state: Uint8Array): void {
    for (let i = 0; i < 16; i++) state[i] = AES_S_BOX[state[i]]
  }

  private shiftRows(state: Uint8Array): void {
    const temp = [...state]
    state[1] = temp[5]
    state[5] = temp[9]
    state[9] = temp[13]
    state[13] = temp[1]
    state[2] = temp[10]
    state[6] = temp[14]
    state[10] = temp[2]
    state[14] = temp[6]
    state[3] = temp[15]
    state[7] = temp[3]
    state[11] = temp[7]
    state[15] = temp[11]
  }

  private mixColumns(state: Uint8Array): void {
    for (let i = 0; i < 4; i++) {
      const s0 = state[i * 4]
      const s1 = state[i * 4 + 1]
      const s2 = state[i * 4 + 2]
      const s3 = state[i * 4 + 3]
      state[i * 4] = this.gmul(2, s0) ^ this.gmul(3, s1) ^ s2 ^ s3
      state[i * 4 + 1] = s0 ^ this.gmul(2, s1) ^ this.gmul(3, s2) ^ s3
      state[i * 4 + 2] = s0 ^ s1 ^ this.gmul(2, s2) ^ this.gmul(3, s3)
      state[i * 4 + 3] = this.gmul(3, s0) ^ s1 ^ s2 ^ this.gmul(2, s3)
    }
  }

  private addRoundKey(state: Uint8Array, roundKey: Uint8Array): void {
    for (let i = 0; i < 16; i++) state[i] ^= roundKey[i]
  }

  private keyExpansion(): Uint8Array {
    const expandedKey = new Uint8Array(176)
    expandedKey.set(this.key)
    let bytesGenerated = 16
    let rconIteration = 1
    const temp = new Uint8Array(4)
    while (bytesGenerated < 176) {
      for (let i = 0; i < 4; i++) temp[i] = expandedKey[bytesGenerated - 4 + i]
      if (bytesGenerated % 16 === 0) {
        const t = temp[0]
        temp[0] = temp[1]
        temp[1] = temp[2]
        temp[2] = temp[3]
        temp[3] = t
        for (let i = 0; i < 4; i++) temp[i] = AES_S_BOX[temp[i]]
        temp[0] ^= AES_RCON[rconIteration - 1]
        rconIteration++
      }
      for (let i = 0; i < 4; i++) {
        expandedKey[bytesGenerated] = expandedKey[bytesGenerated - 16] ^ temp[i]
        bytesGenerated++
      }
    }
    return expandedKey
  }

  private encryptBlock(input: Uint8Array): Uint8Array {
    const state = new Uint8Array(16)
    state.set(input)
    const expandedKey = this.keyExpansion()
    this.addRoundKey(state, expandedKey.slice(0, 16))
    for (let round = 1; round < 10; round++) {
      this.subBytes(state)
      this.shiftRows(state)
      this.mixColumns(state)
      this.addRoundKey(state, expandedKey.slice(round * 16, (round + 1) * 16))
    }
    this.subBytes(state)
    this.shiftRows(state)
    this.addRoundKey(state, expandedKey.slice(160, 176))
    return state
  }

  private pkcs7Pad(data: Uint8Array): Uint8Array {
    const blockSize = 16
    const padding = blockSize - (data.length % blockSize)
    const padded = new Uint8Array(data.length + padding)
    padded.set(data)
    for (let i = data.length; i < padded.length; i++) padded[i] = padding
    return padded
  }

  encryptHex(plaintext: string): string {
    const data = new TextEncoder().encode(plaintext)
    const padded = this.pkcs7Pad(data)
    let result = ''
    for (let i = 0; i < padded.length; i += 16) {
      const encrypted = this.encryptBlock(padded.slice(i, i + 16))
      for (let j = 0; j < 16; j++) result += encrypted[j].toString(16).padStart(2, '0')
    }
    return result.toLowerCase()
  }
}

interface IlanzouListItem {
  fileType?: number
  name?: string
  fileName?: string
  folderId?: number | string
  fileId?: number | string
  fileIds?: number | string
  userId?: number | string
  fileSize?: number | string
}

interface IlanzouListResp {
  code: number
  msg?: string
  list?: IlanzouListItem[]
}

function buildHeaders(): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://www.ilanzou.com/',
    Origin: 'https://www.ilanzou.com',
    'User-Agent': DEFAULT_UA,
  }
}

function extractShareId(url: string): string {
  const trimmed = url.trim()
  const match = trimmed.match(/ilanzou\.com\/s\/([a-zA-Z0-9]+)/)
  if (match) return match[1]
  const parts = trimmed.replace(/\/+$/, '').split('/')
  let last = parts[parts.length - 1] ?? ''
  const queryIndex = last.indexOf('?')
  if (queryIndex !== -1) last = last.substring(0, queryIndex)
  return last
}

/** POST 请求，命中 acw_sc__v2 验证页时自动算出Cookie重试一次，返回解析后的JSON */
async function postJsonWithAcwRetry(url: string, headers: Record<string, string>): Promise<IlanzouListResp> {
  const res = await fetch(url, { method: 'POST', headers })
  let text = await res.text()

  const arg1Match = text.match(/arg1='([0-9A-Fa-f]+)'/)
  if (arg1Match) {
    const cookie = solveAcwScV2(arg1Match[1])
    const retryRes = await fetch(url, { method: 'POST', headers: { ...headers, Cookie: `acw_sc__v2=${cookie}` } })
    text = await retryRes.text()
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new ParseError('蓝奏云优享版返回数据异常，服务可能暂时不可用')
  }
}

function buildRecommendUrl(shareId: string, pwd: string | undefined, encryptedTimestamp: string, uuid: string): string {
  const params = new URLSearchParams({
    devType: '6',
    devModel: 'Chrome',
    uuid,
    extra: '2',
    timestamp: encryptedTimestamp,
    shareId,
    type: '0',
    offset: '1',
    limit: '60',
  })
  if (pwd) params.append('code', pwd)
  return `https://api.ilanzou.com/unproved/recommend/list?${params.toString()}`
}

async function fetchFolderList(
  folderId: string,
  shareId: string,
  uuid: string,
  aes: AES128ECB,
  headers: Record<string, string>,
): Promise<IlanzouListItem[]> {
  const encryptedTimestamp = aes.encryptHex(String(Date.now()))
  const url =
    `https://api.ilanzou.com/unproved//share/list?devType=6&devModel=Chrome&uuid=${uuid}` +
    `&extra=2&timestamp=${encryptedTimestamp}&shareId=${shareId}&folderId=${folderId}&offset=1&limit=60`
  const data = await postJsonWithAcwRetry(url, headers)
  if (data.code !== 200) {
    throw new ParseError(data.msg ?? '蓝奏云优享版文件夹解析失败')
  }
  return data.list ?? []
}

function resolveItemFileId(item: IlanzouListItem): string {
  return String(item.fileId ?? item.fileIds ?? '')
}

function buildFolderResult(items: IlanzouListItem[], shareId: string, folderId: string): ParsedFolder {
  const folderItems: ParsedFolder['files'] = []
  for (const item of items) {
    const fileType = item.fileType ?? 1
    const itemName = String(item.name ?? item.fileName ?? '未知')
    if (fileType === 2) {
      const subFolderId = String(item.folderId ?? '')
      folderItems.push({
        fileId: `dir-${subFolderId}`,
        fileName: `📁 ${itemName}`,
        url: `https://www.ilanzou.com/s/${shareId}?__izfid=${subFolderId}`,
      })
    } else {
      const fileId = resolveItemFileId(item)
      const fileSizeKB = parseInt(String(item.fileSize ?? '0'), 10) || 0
      folderItems.push({
        fileId,
        fileName: itemName,
        fileSize: String(fileSizeKB * 1024),
        url: `https://www.ilanzou.com/s/${shareId}?__izfid=${folderId}&__izfileid=${fileId}`,
      })
    }
  }
  if (!folderItems.length) {
    throw new ParseError('该文件夹分享没有可用文件')
  }
  return { panType: 'ilanzou', panName: '蓝奏云优享版', files: folderItems }
}

function extractFilenameFromUrl(downloadUrl: string): string | undefined {
  try {
    const filename = new URL(downloadUrl).searchParams.get('filename')
    return filename ? decodeURIComponent(filename) : undefined
  } catch {
    return undefined
  }
}

/**
 * 请求 file/redirect 端点换取真正的下载直链：可能直接 302 到CDN直链（走 Location 头），
 * 也可能命中 acw_sc__v2 验证（最多重试3次），或者返回一段包含直链的JSON/文本。
 */
async function getDownloadUrl(
  fileId: string,
  userId: string,
  shareId: string,
  uuid: string,
  aes: AES128ECB,
  headers: Record<string, string>,
): Promise<string> {
  const timestamp = Date.now()
  const encryptedTimestamp = aes.encryptHex(String(timestamp))
  const auth = aes.encryptHex(`${fileId}|${timestamp}`)
  const downloadId = aes.encryptHex(`${fileId}|${userId}`)
  const redirectUrl =
    `https://api.ilanzou.com/unproved/file/redirect?downloadId=${downloadId}` +
    `&enable=1&devType=6&uuid=${uuid}&timestamp=${encryptedTimestamp}&auth=${auth}&shareId=${shareId}`

  const MAX_RETRIES = 3
  let acwCookie = ''
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const reqHeaders = acwCookie ? { ...headers, Cookie: `acw_sc__v2=${acwCookie}` } : headers
    const res = await fetch(redirectUrl, { headers: reqHeaders, redirect: 'manual' })
    const location = res.headers.get('location')
    if (location) return location

    const text = await res.text()
    const arg1Match = text.match(/arg1='([0-9A-Fa-f]+)'/)
    if (arg1Match) {
      acwCookie = solveAcwScV2(arg1Match[1])
      if (attempt < MAX_RETRIES - 1) continue
      break
    }

    if (res.status === 200) {
      try {
        const json = JSON.parse(text) as { code?: number; data?: string }
        if (json.code === 200 && json.data) return json.data
      } catch {
        const urlMatch = text.match(/https?:\/\/[^\s"']+/i)
        if (urlMatch) return urlMatch[0]
      }
    }
    break
  }
  return ''
}

async function resolveFileDownload(
  item: IlanzouListItem,
  shareId: string,
  uuid: string,
  aes: AES128ECB,
  headers: Record<string, string>,
): Promise<ParsedFile> {
  const fileId = resolveItemFileId(item)
  if (!fileId) {
    throw new ParseError('文件信息获取失败')
  }
  const fileName = String(item.name ?? item.fileName ?? '')
  const rawSize = item.fileSize
  const fileSize = rawSize !== undefined ? String(rawSize) : undefined

  const downloadUrl = await getDownloadUrl(fileId, String(item.userId ?? ''), shareId, uuid, aes, headers)
  if (!downloadUrl) {
    throw new ParseError('获取下载链接失败，链接可能已失效或触发了反爬验证，请稍后重试')
  }

  return {
    panType: 'ilanzou',
    panName: '蓝奏云优享版',
    fileName: fileName || extractFilenameFromUrl(downloadUrl),
    fileSize,
    directLink: downloadUrl,
  }
}

/**
 * 蓝奏云优享版（ilanzou.com）解析，不需要登录账号即可运作（匿名模式）。
 * 分享可能是单文件，也可能是文件夹（通过 URL 上的 __izfid/__izfileid 参数记录浏览状态，
 * 跟夸克/百度网盘的文件夹导航模式一致）。
 */
export async function parseIlanzou(ctx: ParserContext): Promise<ParsedFile | ParsedFolder> {
  const { url, pwd } = ctx
  const shareId = extractShareId(url)
  if (!shareId) {
    throw new ParseError('无法识别蓝奏云优享版分享链接')
  }

  let folderId: string | null = null
  let targetFileId: string | null = null
  try {
    const parsed = new URL(url)
    folderId = parsed.searchParams.get('__izfid')
    targetFileId = parsed.searchParams.get('__izfileid')
  } catch {
    // 忽略，按根目录处理
  }

  const uuid = crypto.randomUUID().toLowerCase()
  const aes = new AES128ECB(AES_KEY)
  const headers = buildHeaders()

  if (folderId) {
    const items = await fetchFolderList(folderId, shareId, uuid, aes, headers)
    if (targetFileId) {
      const target = items.find((item) => resolveItemFileId(item) === targetFileId)
      if (!target) {
        throw new ParseError('未找到该文件，链接可能已失效')
      }
      return await resolveFileDownload(target, shareId, uuid, aes, headers)
    }
    return buildFolderResult(items, shareId, folderId)
  }

  const encryptedTimestamp = aes.encryptHex(String(Date.now()))
  const apiUrl = buildRecommendUrl(shareId, pwd, encryptedTimestamp, uuid)
  const data = await postJsonWithAcwRetry(apiUrl, headers)

  if (data.code !== 200) {
    const msg = data.msg ?? '请求失败'
    if (msg.includes('密码') || msg.includes('提取码')) {
      throw new ParseError(pwd ? '提取码错误' : '该分享需要提取码')
    }
    throw new ParseError(msg)
  }
  if (!data.list?.length) {
    throw new ParseError('未找到文件信息')
  }

  let item = data.list[0]
  const inner = (item as { fileList?: IlanzouListItem[] }).fileList
  if (Array.isArray(inner) && inner.length > 0) {
    const preservedFileIds = item.fileIds
    const preservedUserId = item.userId
    item = { ...item, ...inner[0] }
    if (preservedFileIds && !inner[0].fileIds) item.fileIds = preservedFileIds
    if (preservedUserId && !inner[0].userId) item.userId = preservedUserId
  }

  const fileType = item.fileType ?? 1
  if (fileType === 2) {
    const rootFolderId = String(item.folderId ?? '')
    const items = await fetchFolderList(rootFolderId, shareId, uuid, aes, headers)
    return buildFolderResult(items, shareId, rootFolderId)
  }

  if (!item.fileName && !item.name && item.fileSize === undefined && !pwd) {
    throw new ParseError('该分享需要提取码')
  }

  return await resolveFileDownload(item, shareId, uuid, aes, headers)
}
