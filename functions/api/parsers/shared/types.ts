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
