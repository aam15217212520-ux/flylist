import type { Env } from '../parsers/shared/types'

const SESSION_COOKIE = 'flylist_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7天

export async function createSession(env: Env): Promise<string> {
  const id = crypto.randomUUID()
  await env.FLYLIST_KV.put(`session:${id}`, '1', { expirationTtl: SESSION_TTL_SECONDS })
  return id
}

export function sessionCookieHeader(id: string): string {
  return `${SESSION_COOKIE}=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie') ?? ''
  const match = cookie.match(new RegExp(`${name}=([^;]+)`))
  return match ? match[1] : null
}

export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const sessionId = readCookie(request, SESSION_COOKIE)
  if (!sessionId) return false
  const value = await env.FLYLIST_KV.get(`session:${sessionId}`)
  return value !== null
}

export async function destroySession(request: Request, env: Env): Promise<void> {
  const sessionId = readCookie(request, SESSION_COOKIE)
  if (sessionId) await env.FLYLIST_KV.delete(`session:${sessionId}`)
}
