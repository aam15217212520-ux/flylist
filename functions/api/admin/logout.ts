import type { Env } from '../parsers/shared/types'
import { destroySession, clearSessionCookieHeader } from './_session'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  await destroySession(request, env)
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookieHeader() },
  })
}
