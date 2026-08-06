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
