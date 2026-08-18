import { DEFAULT_UA } from './shared/http'
import type { ParsedFile, ParserContext } from './shared/types'
import { ParseError } from './shared/types'

// ---- 阿里云WAF人机验证(acw_sc__v2)：置换 + 异或，纯计算即可复现，不需要跑浏览器 ----
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

interface FetchResult {
  html: string
  location: string | null
}

/** GET 一个地址；如果命中 acw_sc__v2 人机验证页，自动算出验证值并带 Cookie 重新请求一次 */
async function getBypassWaf(url: string, extraHeaders: Record<string, string>): Promise<FetchResult> {
  const headers = { 'User-Agent': DEFAULT_UA, ...extraHeaders }
  let res = await fetch(url, { headers, redirect: 'manual' })
  let html = await res.text()
  let location = res.headers.get('location')

  const arg1Match = html.match(/arg1='([0-9A-Fa-f]+)'/)
  if (arg1Match) {
    const cookie = solveAcwScV2(arg1Match[1])
    res = await fetch(url, { headers: { ...headers, Cookie: `acw_sc__v2=${cookie}` }, redirect: 'manual' })
    html = await res.text()
    location = res.headers.get('location')
  }
  return { html, location }
}

async function postBypassWaf(
  url: string,
  form: Record<string, string>,
  extraHeaders: Record<string, string>,
): Promise<string> {
  const body = new URLSearchParams(form).toString()
  const headers = {
    'User-Agent': DEFAULT_UA,
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Requested-With': 'XMLHttpRequest',
    ...extraHeaders,
  }
  const res = await fetch(url, { method: 'POST', headers, body })
  return res.text()
}

function parseLzJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return null
  }
}

interface AjaxCall {
  path: string
  form: Record<string, string>
}

/** 蓝奏云分享页的签名字段有好几种历史格式，逐个尝试，跟官方前端 JS 的取值逻辑保持一致 */
function extractAjaxCall(html: string, pwd?: string): AjaxCall | null {
  const ajaxPathMatch = html.match(/(?:['"/]|^)(ajax(?:m|file)\.php\?file=\d+)/)
  if (!ajaxPathMatch) return null
  const path = '/' + ajaxPathMatch[1]

  const form: Record<string, string> = { action: 'downprocess' }

  const wpSign = html.match(/wp_sign\s*=\s*'([^']+)'/)
  const ajaxData = html.match(/ajaxdata\s*=\s*'([^']+)'/)
  const isngisAll = [...html.matchAll(/var\s+isngis\s*=\s*'([^']+)'/g)].map((m) => m[1]).filter(Boolean)
  const lastIsngis = isngisAll.length ? isngisAll[isngisAll.length - 1] : null

  if (wpSign) {
    form.sign = wpSign[1]
    if (ajaxData) {
      form.websignkey = ajaxData[1]
      form.signs = ajaxData[1]
    }
    const websign = html.match(/'websign'\s*:\s*'([^']*)'/)
    form.websign = websign ? websign[1] : ''
    form.kd = '1'
    form.ves = '1'
    if (pwd) form.p = pwd
  } else if (lastIsngis) {
    form.sign = lastIsngis
    form.kd = '1'
    if (pwd) form.p = pwd
  } else {
    const signs = [...html.matchAll(/'sign'\s*:\s*'([^']+)'/g)].map((m) => m[1])
    if (!signs.length) return null
    form.sign = signs.length > 1 ? signs[1] : signs[0]
    if (pwd) form.p = pwd
    form.kd = '1'
    if (ajaxData) {
      form.websignkey = ajaxData[1]
      form.signs = ajaxData[1]
    }
  }

  return { path, form }
}

function isDirectLink(url: string | null): url is string {
  if (!url) return false
  if (url.includes('SignError') || url.includes('/file/?')) return false
  if (/^itms-services:|^itms:|\.plist|ipa\.lanrar\.com/i.test(url)) return false
  return url.startsWith('http://') || url.startsWith('https://')
}

/**
 * 拿到 dom+token 拼出的中间跳转地址后，还不是最终CDN直链：
 * 可能直接 302 到直链，也可能出一个"验证并下载"页，需要等待约2秒后
 * 再 POST 一次 /file/ajax.php 才能换到真正的直链。
 */
async function followIntermediateUrl(downUrl: string): Promise<string> {
  const origin = new URL(downUrl).origin
  const { html, location } = await getBypassWaf(downUrl, { Referer: origin })

  if (isDirectLink(location)) {
    return location
  }

  if (html.includes('down_r') && html.includes('ajax.php')) {
    const fileMatch = html.match(/'file'\s*:\s*'([^']+)'/)
    const signMatch = html.match(/'sign'\s*:\s*'([^']+)'/)
    if (!fileMatch || !signMatch) {
      throw new ParseError('蓝奏云验证页缺少必要参数', downUrl)
    }
    // 验证页有约2秒的加载动画，过早提交会返回 SignError
    await new Promise((resolve) => setTimeout(resolve, 2200))
    const respText = await postBypassWaf(
      `${origin}/file/ajax.php`,
      { file: fileMatch[1], el: '2', sign: signMatch[1] },
      { Referer: downUrl, Origin: origin },
    )
    const json = parseLzJson(respText) as { url?: string } | null
    if (json?.url && isDirectLink(json.url)) {
      return json.url
    }
    throw new ParseError('蓝奏云二次验证未返回直链', downUrl)
  }

  throw new ParseError('蓝奏云下载域未返回直链，请稍后重试', downUrl)
}

export async function parseLanzou(ctx: ParserContext): Promise<ParsedFile> {
  const { url, pwd } = ctx
  const origin = new URL(url).origin

  let { html } = await getBypassWaf(url, { Referer: origin })

  // 部分分享用 iframe 包了一层，真正的下载信息在 iframe 里
  const iframeMatch = html.match(/src\s*=\s*["'](\/fn\?[^"'\s>]+)["']/i)
  if (iframeMatch) {
    const iframeUrl = origin + iframeMatch[1]
    const iframeRes = await getBypassWaf(iframeUrl, { Referer: url })
    html = iframeRes.html
  }

  if (/请输入密码|id=["']pwd["']|down_p/i.test(html) && !extractAjaxCall(html, pwd)) {
    if (!pwd) {
      throw new ParseError('该分享需要提取码')
    }
  }

  const call = extractAjaxCall(html, pwd)
  if (!call) {
    if (/acw_sc__v2/i.test(html)) {
      throw new ParseError('蓝奏云触发了人机验证，服务器自动越过尝试未成功，请在新标签页打开原始链接自行下载', url)
    }
    throw new ParseError('未能从蓝奏云分享页提取下载信息，页面结构可能已更新')
  }

  const ajaxUrl = origin + call.path
  const ajaxRespText = await postBypassWaf(ajaxUrl, call.form, { Referer: url })
  const ajaxJson = parseLzJson(ajaxRespText) as { zt?: number; dom?: string; url?: string; inf?: string } | null

  if (!ajaxJson || ajaxJson.zt !== 1 || !ajaxJson.dom || !ajaxJson.url) {
    throw new ParseError('蓝奏云解析失败，链接可能已失效或提取码错误')
  }

  const intermediateUrl = `${ajaxJson.dom}/file/${ajaxJson.url}`

  try {
    const directLink = await followIntermediateUrl(intermediateUrl)
    return { panType: 'lanzou', panName: '蓝奏云', fileName: ajaxJson.inf, directLink }
  } catch (error) {
    if (error instanceof ParseError) throw error
    // 服务器端没能拿到最终直链时，把中间跳转地址交给访客的浏览器自己完成（浏览器能跑JS，大概率能过）
    throw new ParseError('蓝奏云解析未完全成功，请在新标签页打开链接自行下载', intermediateUrl)
  }
}
