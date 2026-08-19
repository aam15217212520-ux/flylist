export interface Env {
  FLYLIST_KV: KVNamespace
}

export interface ParserContext {
  env: Env
  url: string
  pwd?: string
}

export interface ParsedFile {
  panType: string
  panName: string
  fileName?: string
  fileSize?: string
  directLink: string
  /** 该直链要求下载方 User-Agent 精确匹配 requiredUA 才能访问（目前仅百度网盘需要），
   * 浏览器无法自定义此请求头直接下载，前端需引导用户使用支持自定义 UA 的下载工具（如 IDM）。 */
  requiredUA?: string
}

/** 蓝奏云等网盘的“文件夹/文件列表”分享，没有单一直链，需要访客再挑一个文件 */
export interface ParsedFolder {
  panType: string
  panName: string
  folderName?: string
  files: { fileId: string; fileName: string; fileSize?: string; url: string }[]
}

export function isParsedFolder(x: ParsedFile | ParsedFolder): x is ParsedFolder {
  return 'files' in x
}

export class ParseError extends Error {
  /** 当服端无法自动解析时（比如遇到人机验证），可选地带上原始分享链接，
   * 让前端引导访客在新标签页自己打开。 */
  fallbackUrl?: string

  constructor(message: string, fallbackUrl?: string) {
    super(message)
    this.fallbackUrl = fallbackUrl
  }
}
