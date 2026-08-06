import type { Env } from '../parsers/shared/types'
import { readJsonBody } from '../parsers/shared/http'
import { hashPassword } from './_password'
import { createSession, sessionCookieHeader } from './_session'

interface AdminAuthConfig {
  passwordHash: string
}

interface LoginBody {
  password?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await readJsonBody<LoginBody>(request)
  if (!body?.password) {
    return Response.json({ success: false, message: '请输入密码' }, { status: 400 })
  }

  const stored = await env.FLYLIST_KV.get<AdminAuthConfig>('config:admin', 'json')
  const incomingHash = await hashPassword(body.password)

  if (!stored) {
    // 首次使用：本次输入的密码将被设置为初始管理密码
    await env.FLYLIST_KV.put('config:admin', JSON.stringify({ passwordHash: incomingHash }))
    const sessionId = await createSession(env)
    return new Response(JSON.stringify({ success: true, firstSetup: true }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookieHeader(sessionId) },
    })
  }

  if (stored.passwordHash !== incomingHash) {
    return Response.json({ success: false, message: '密码错误' }, { status: 401 })
  }

  const sessionId = await createSession(env)
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookieHeader(sessionId) },
  })
}
