export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export interface FetchOptions {
  headers?: Record<string, string>
  method?: string
  body?: string
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      'User-Agent': DEFAULT_UA,
      ...options.headers,
    },
    body: options.body,
  })
  return res.text()
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      'User-Agent': DEFAULT_UA,
      Accept: 'application/json',
      ...options.headers,
    },
    body: options.body,
  })
  return (await res.json()) as T
}

export async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

/** ASCII 化文件名，用作 Content-Disposition 里旧式 filename= 的兜底值（不支持非 ASCII 字符）。 */
function toAsciiFallback(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'")
  return ascii || 'download'
}

/**
 * 构造下载响应的 Content-Disposition 头，同时带上新旧两种文件名语法：
 *   - filename="..."      旧式语法，非 ASCII 字符会被替换成下划线，供不认识 filename* 的客户端兜底识别
 *   - filename*=UTF-8''... RFC 5987 语法，支持完整的中文/特殊字符文件名
 * 一些下载工具（如部分版本的 IDM）不认新式语法时会直接退回用 URL 路径当文件名，
 * 因此两种语法都要提供，不能只写新式的。
 */
export function buildContentDisposition(fileName?: string): string {
  if (!fileName) return 'attachment'
  return `attachment; filename="${toAsciiFallback(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}
