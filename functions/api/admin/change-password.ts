import type { Env } from '../parsers/shared/types'
import { readJsonBody } from '../parsers/shared/http'
import { hashPassword } from './_password'
import { isAuthenticated } from './_session'

interface AdminAuthConfig {
  passwordHash: string
}

interface ChangePasswordBody {
  oldPassword?: string
  newPassword?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authed = await isAuthenticated(request, env)
  if (!authed) return Response.json({ success: false, message: '未登录' }, { status: 401 })

  const body = await readJsonBody<ChangePasswordBody>(request)
  if (!body?.oldPassword || !body?.newPassword) {
    return Response.json({ success: false, message: '请输入原密码和新密码' }, { status: 400 })
  }
  if (body.newPassword.length < 6) {
    return Response.json({ success: false, message: '新密码长度至少为 6 位' }, { status: 400 })
  }

  const stored = await env.FLYLIST_KV.get<AdminAuthConfig>('config:admin', 'json')
  if (!stored) {
    return Response.json({ success: false, message: '尚未设置管理密码' }, { status: 400 })
  }

  const oldHash = await hashPassword(body.oldPassword)
  if (stored.passwordHash !== oldHash) {
    return Response.json({ success: false, message: '原密码不正确' }, { status: 401 })
  }

  const newHash = await hashPassword(body.newPassword)
  await env.FLYLIST_KV.put('config:admin', JSON.stringify({ passwordHash: newHash }))

  return Response.json({ success: true })
}
