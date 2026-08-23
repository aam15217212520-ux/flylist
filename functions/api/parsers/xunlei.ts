import { fetchJson } from './shared/http'
import type { Env, ParsedFile, ParsedFolder, ParserContext } from './shared/types'
import { ParseError } from './shared/types'
import type { SiteConfig } from './shared/config'
import { getSiteConfig, saveSiteConfig } from './shared/config'

const XUNLEI_API = 'https://api-pan.xunlei.com/drive/v1'
const XLUSER_API = 'https://xluser-ssl.xunlei.com/v1'
const CLIENT_ID = 'Xqp0kJBXWhwaTpB6'
const DEVICE_ID = '925b7631473a13716b791d7f28289cad'
const XUNLEI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
/** 轮询等待转存任务完成的次数上限，每次间隔 2s，总计最多约 40 秒 */
const WAIT_MAX = 20

interface XunleiTokenResp {
  access_token?: string
  refresh_token?: string
  error?: string
  error_description?: string
}

interface CaptchaTokenResp {
  captcha_token?: string
  error?: string
}

interface ShareInfo {
  code?: number
  msg?: string
  error?: string
  error_description?: string
  share_status?: string
  share_status_text?: string
  pass_code_token?: string
  files?: XunleiFileItem[]
  data?: {
    share_status?: string
    share_status_text?: string
    pass_code_token?: string
    files?: XunleiFileItem[]
  }
}

interface XunleiFileItem {
  id: string
  name: string
  size?: number
  kind?: string
  web_content_link?: string
}

interface RestoreResp {
  restore_task_id?: string
  error?: string
  error_description?: string
  msg?: string
}

interface TaskResp {
  progress?: number
  params?: {
    trace_file_ids?: string
  }
}

interface FileDetail {
  web_content_link?: string
  size?: number
  name?: string
}

function basicHeaders(): Record<string, string> {
  return {
    'User-Agent': XUNLEI_UA,
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    'Origin': 'https://pan.xunlei.com',
    'Referer': 'https://pan.xunlei.com/',
    'x-client-id': CLIENT_ID,
    'x-device-id': DEVICE_ID,
  }
}

async function refreshAccessToken(config: SiteConfig, env: Env): Promise<string> {
  const refreshToken = config.xunlei?.refreshToken
  if (!refreshToken) {
    throw new ParseError('管理员尚未在后台配置迅雷网盘账号，暂不支持解析')
  }

  const resp = await fetchJson<XunleiTokenResp>(`${XLUSER_API}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (resp.error || !resp.access_token) {
    throw new ParseError(resp.error_description ?? resp.error ?? '迅雷网盘账号登录态已失效，请在后台重新配置 refresh token')
  }

  // 保存新的 refresh_token（服务端可能会轮换）
  const newRefreshToken = resp.refresh_token
  if (newRefreshToken && newRefreshToken !== refreshToken) {
    config.xunlei = {
      ...config.xunlei,
      refreshToken: newRefreshToken,
      updatedAt: Date.now(),
    }
    await saveSiteConfig(env, config)
  }

  return resp.access_token
}

/** 获取 captcha_token。迅雷分享 API 要求附带这个 token 才能访问。
 * 使用硬编码的 captcha_sign 和 timestamp（参考 PHP 实现），如果后续服务端拒绝，可切换为动态签名算法。 */
async function getCaptchaToken(): Promise<string> {
  const resp = await fetchJson<CaptchaTokenResp>(`${XLUSER_API}/shield/captcha/init`, {
    method: 'POST',
    headers: basicHeaders(),
    body: JSON.stringify({
      client_id: CLIENT_ID,
      action: 'get:/drive/v1/share',
      device_id: DEVICE_ID,
      meta: {
        package_name: 'pan.xunlei.com',
        client_version: '1.45.0',
        captcha_sign: '1.fe2108ad808a74c9ac0243309242726c',
        timestamp: '1645241033384',
      },
    }),
  })

  if (resp.error) {
    throw new Error(resp.error)
  }
  if (!resp.captcha_token) {
    throw new Error('获取 captcha_token 失败，迅雷接口可能已变更，请稍后再试')
  }
  return resp.captcha_token
}

function extractShareInfo(url: string): { shareId: string; passCode: string } | null {
  const match = url.match(/pan\.xunlei\.com\/s\/([A-Za-z0-9_-]+)/)
  if (!match) return null
  const shareId = match[1].split('?')[0].replace(/#/g, '')
  const urlParams = (() => {
    try {
      return new URL(url).searchParams
    } catch {
      return new URLSearchParams()
    }
  })()
  const passCode = urlParams.get('pwd') || ''
  return { shareId, passCode }
}

async function fetchShareInfo(
  accessToken: string,
  captchaToken: string,
  shareId: string,
  passCode: string,
): Promise<{ files: XunleiFileItem[]; passCodeToken: string | null }> {
  const params = new URLSearchParams({
    share_id: shareId,
    pass_code: passCode,
    limit: '100',
    thumbnail_size: 'SIZE_SMALL',
  })
  const resp = await fetchJson<ShareInfo>(`${XUNLEI_API}/share?${params.toString()}`, {
    method: 'GET',
    headers: {
      ...basicHeaders(),
      'Authorization': `Bearer ${accessToken}`,
      'x-captcha-token': captchaToken,
    },
  })

  if (resp.error || resp.error_description) {
    throw new ParseError(resp.error_description ?? resp.error ?? '迅雷网盘接口返回错误')
  }
  // 真实接口多数直接返回顶层字段；部分包装成 { data }，两边都认。
  const payload = resp.data ?? resp
  const shareStatus = payload.share_status
  if (shareStatus !== 'OK') {
    const statusText = payload.share_status_text ?? resp.msg
    if (statusText) throw new ParseError(statusText)
    if (shareStatus === 'SENSITIVE_RESOURCE') {
      throw new ParseError('该分享内容可能涉及违规信息，无法访问')
    }
    throw new ParseError('迅雷网盘分享内容已失效或不可访问')
  }

  const passCodeToken = payload.pass_code_token ?? null
  const files = payload.files ?? []
  if (files.length === 0) {
    throw new ParseError('该分享目录下没有文件')
  }
  return { files, passCodeToken }
}

/** 提取目标文件的 ID：优先使用 URL 上的 __xfid 参数，否则取第一个普通文件 */
function findTargetFile(files: XunleiFileItem[], url: string): { fileId: string; fileName: string } | null {
  try {
    const explicitId = new URL(url).searchParams.get('__xfid')
    if (explicitId) {
      const match = files.find((f) => f.id === explicitId)
      return match ? { fileId: match.id, fileName: match.name } : null
    }
  } catch {
    // ignore
  }
  // 取第一个普通文件（非文件夹）
  const file = files.find((f) => f.kind !== 'drive#folder')
  return file ? { fileId: file.id, fileName: file.name } : null
}

async function restoreFiles(
  accessToken: string,
  captchaToken: string,
  shareId: string,
  passCodeToken: string | null,
  fileIds: string[],
): Promise<string | null> {
  const body: Record<string, unknown> = {
    parent_id: '',
    share_id: shareId,
    pass_code_token: passCodeToken || '',
    ancestor_ids: [],
    specify_parent_id: true,
    file_ids: fileIds,
  }

  const resp = await fetchJson<RestoreResp>(`${XUNLEI_API}/share/restore`, {
    method: 'POST',
    headers: {
      ...basicHeaders(),
      'Authorization': `Bearer ${accessToken}`,
      'x-captcha-token': captchaToken,
    },
    body: JSON.stringify(body),
  })

  if (resp.restore_task_id) return resp.restore_task_id
  // 分享者就是管理员账号自己时，迅雷拒绝转存（error: file_restore_own）。
  // 这种情况下分享里的原始文件 ID 已经在管理员网盘里，可以直接签发直链，无需转存也无需清理。
  if (resp.error === 'file_restore_own') return null
  throw new ParseError(resp.error_description ?? resp.msg ?? resp.error ?? '迅雷网盘发起转存失败，请检查账号状态')
}

async function waitForTask(accessToken: string, captchaToken: string, taskId: string): Promise<Record<string, string>> {
  const taskUrl = `${XUNLEI_API}/tasks/${taskId}`
  for (let i = 0; i < WAIT_MAX; i++) {
    const resp = await fetchJson<TaskResp>(taskUrl, {
      method: 'GET',
      headers: {
        ...basicHeaders(),
        'Authorization': `Bearer ${accessToken}`,
        'x-captcha-token': captchaToken,
      },
    })

    if (resp.progress === 100 && resp.params?.trace_file_ids) {
      try {
        return JSON.parse(resp.params.trace_file_ids) as Record<string, string>
      } catch {
        // trace_file_ids 解析失败，继续轮询
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new ParseError('迅雷网盘转存超时，请稍后重试')
}

async function getFileDetail(accessToken: string, captchaToken: string, fileId: string): Promise<FileDetail> {
  const resp = await fetchJson<FileDetail>(`${XUNLEI_API}/files/${fileId}`, {
    method: 'GET',
    headers: {
      ...basicHeaders(),
      'Authorization': `Bearer ${accessToken}`,
      'x-captcha-token': captchaToken,
    },
  })
  return resp
}

async function deleteFiles(accessToken: string, captchaToken: string, fileIds: string[]): Promise<void> {
  try {
    await fetchJson(`${XUNLEI_API}/files:batchDelete`, {
      method: 'POST',
      headers: {
        ...basicHeaders(),
        'Authorization': `Bearer ${accessToken}`,
        'x-captcha-token': captchaToken,
      },
      body: JSON.stringify({ ids: fileIds, space: '' }),
    })
  } catch (error) {
    // 删除失败不影响下载，只记录日志
    console.error('[xunlei] 清理转存文件失败:', error instanceof Error ? error.message : error)
  }
}

interface XunleiDownloadToken {
  /** 用于签发下载直链的文件 ID。转存路径下是转存后的新 ID，自有文件路径下就是分享里的原始 ID */
  fileId: string
  /** 本次转存产生的全部文件 ID，下载取流开始后一并清理。自有文件不转存，这里为空 */
  cleanupIds: string[]
}

/**
 * 迅雷网盘解析。官方接口没有免登录直链，必须先把分享文件转存到管理员账号自己的网盘，
 * 才能拿到 web_content_link（下载直链）。
 *
 * 流程：
 * 1. 用 refresh_token 换 access_token
 * 2. 获取 captcha_token
 * 3. 获取分享信息，拿到 pass_code_token 和文件列表
 * 4. 转存目标文件到管理员账号（restore）
 * 5. 转存目标文件到管理员账号（restore）；若分享者就是管理员自己，迅雷会拒绝转存，此时直接用原始文件 ID
 * 6. 轮询等待转存完成，拿到新的文件 ID
 * 7. 打包成复合令牌返回（不在这一步签发直链、也不删文件）
 *
 * 注意：签发直链和删除转存文件都推迟到访客点击下载、命中 /api/xunlei-download 代理时才做。
 * 如果在解析阶段就删掉转存文件，那条 web_content_link 会立刻失效（跟阿里云盘同一个坑）。
 */
export async function parseXunlei(ctx: ParserContext): Promise<ParsedFile | ParsedFolder> {
  const { url, pwd, env } = ctx
  const config = await getSiteConfig(env)

  const shareInfo = extractShareInfo(url)
  if (!shareInfo) {
    throw new ParseError('无法识别迅雷网盘分享链接格式')
  }
  const { shareId, passCode } = shareInfo
  const finalPassCode = pwd || passCode

  const accessToken = await refreshAccessToken(config, env)
  const captchaToken = await getCaptchaToken()

  const { files, passCodeToken } = await fetchShareInfo(accessToken, captchaToken, shareId, finalPassCode)

  const target = findTargetFile(files, url)
  if (!target) {
    throw new ParseError('该分享目录下没有找到可下载的文件')
  }

  const restoreIds = [target.fileId]
  const taskId = await restoreFiles(accessToken, captchaToken, shareId, passCodeToken, restoreIds)

  let downloadFileId: string
  let cleanupIds: string[]
  if (taskId === null) {
    // 分享者是管理员自己：文件已在自己网盘里，直接用原始 ID，切记不能清理（那是用户自己的文件）
    downloadFileId = target.fileId
    cleanupIds = []
  } else {
    const traceFileIds = await waitForTask(accessToken, captchaToken, taskId)
    const newFileId = traceFileIds[target.fileId]
    if (!newFileId) {
      throw new ParseError('迅雷网盘转存失败，无法找到目标文件的新 ID')
    }
    downloadFileId = newFileId
    cleanupIds = Object.values(traceFileIds)
  }

  const targetFile = files.find((item) => item.id === target.fileId)
  const token: XunleiDownloadToken = {
    fileId: downloadFileId,
    cleanupIds,
  }
  return {
    panType: 'xunlei',
    panName: '迅雷网盘',
    fileName: target.fileName,
    fileSize: targetFile?.size ? String(targetFile.size) : undefined,
    directLink: JSON.stringify(token),
  }
}

/**
 * 在下载代理这一次请求内现场签发 web_content_link。
 * 必须跟实际取流保持同一次 Function 调用：转存文件此时还在管理员网盘里，签发完立刻取流，
 * 再由 cleanupXunleiFiles 删除转存文件。
 */
export async function resolveXunleiFinalUrl(env: Env, token: string): Promise<string> {
  let parsed: XunleiDownloadToken
  try {
    parsed = JSON.parse(token)
  } catch {
    throw new Error('链接参数无效，请重新解析')
  }
  if (!parsed.fileId) {
    throw new Error('链接参数无效，请重新解析')
  }

  const config = await getSiteConfig(env)
  const accessToken = await refreshAccessToken(config, env)
  const captchaToken = await getCaptchaToken()
  const fileDetail = await getFileDetail(accessToken, captchaToken, parsed.fileId)
  if (!fileDetail.web_content_link) {
    throw new Error('迅雷网盘获取下载直链失败，文件可能已被清理，请重新解析')
  }
  return fileDetail.web_content_link
}

/** 下载取流开始后清理转存文件，避免长期占用管理员网盘容量。删除失败不影响本次下载。 */
export async function cleanupXunleiFiles(env: Env, token: string): Promise<void> {
  let parsed: XunleiDownloadToken
  try {
    parsed = JSON.parse(token)
  } catch {
    return
  }
  const ids = parsed.cleanupIds?.filter(Boolean) ?? []
  if (ids.length === 0) return

  try {
    const config = await getSiteConfig(env)
    const accessToken = await refreshAccessToken(config, env)
    const captchaToken = await getCaptchaToken()
    await deleteFiles(accessToken, captchaToken, ids)
  } catch (error) {
    console.error('[xunlei] 清理转存文件失败:', error instanceof Error ? error.message : error)
  }
}

export function buildXunleiProxyLink(token: string, fileName?: string): string {
  const params = new URLSearchParams({ token })
  if (fileName) {
    params.set('name', fileName)
  }
  return `/api/xunlei-download?${params.toString()}`
}
