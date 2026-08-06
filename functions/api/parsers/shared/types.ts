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

export class ParseError extends Error {}
