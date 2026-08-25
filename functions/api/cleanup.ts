import type { Env } from './parsers/shared/types'
import { getSiteConfig } from './parsers/shared/config'
import { fetchJson } from './parsers/shared/http'

/**
 * 定时清理任务（Cloudflare Pages 不支持 scheduled handler，改用「懒触发」模式）：
 * 每次有人访问 /api/cleanup 时执行一次清理，配合外部免费定时服务
 * （如 cron-job.org、UptimeRobot 每 6/12 小时 GET 一次本地址）即可实现定时清理。
 *
 * 清理范围：
 *   1. 百度账号池各账号 /parse_file 目录下「超过 24 小时无人下载」的转存文件。
 *      转存文件会占满网盘空间导致后续转存失败（errno -8 空间不足），必须定期清理。
 *      「24 小时无人下载」的判定依据：下载代理每次成功取流时会在 KV 记录
 *      `baidudl:<accountId>:<fsId>` = 时间戳；清理时对比该时间戳与转存时间，
 *      超过 24h 未被下载即删除。
 *   2. KV 中对应的转存缓存（baidutransfer:*）一并删除，避免命中已删除文件的缓存。
 */

const PARSE_DIR = '/parse_file'
const CLEANUP_LOCK_KEY = 'cleanup:lock'
const CLEANUP_LOCK_TTL = 60 * 60 // 锁 1 小时，防止并发重复清理
const UNUSED_AFTER_MS = 24 * 60 * 60 * 1000 // 24 小时无人下载即删除

interface ApiListResp {
  errno: number
  list?: Array<{ fs_id: number | string; path: string; server_filename: string; isdir: number | string }>
}

interface FilemanagerResp {
  errno: number
}

async function getBdsToken(cookie: string): Promise<string> {
  const res = await fetchJson<{ errno: number; result?: { bdstoken?: string } }>(
    'https://pan.baidu.com/api/gettemplatevariable?clienttype=0&app_id=250528&web=1&fields=%5B%22bdstoken%22%5D',
    { headers: { Cookie: cookie, Referer: 'https://pan.baidu.com/disk/home' } },
  )
  const token = res.result?.bdstoken
  if (res.errno !== 0 || !token) throw new Error('获取 bdstoken 失败，Cookie 可能已失效')
  return token
}

async function listParseDir(cookie: string, bdstoken: string): Promise<ApiListResp['list']> {
  const res = await fetchJson<ApiListResp>(
    `https://pan.baidu.com/api/list?dir=${encodeURIComponent(PARSE_DIR)}&order=name&desc=0&start=0&limit=500&web=1&app_id=250528&channel=chunlei&clienttype=0&bdstoken=${encodeURIComponent(bdstoken)}`,
    { headers: { Cookie: cookie, Referer: 'https://pan.baidu.com/disk/home' } },
  )
  if (res.errno === -9 || res.errno === 12) return [] // 目录不存在，视为空
  if (res.errno !== 0) throw new Error(`列出转存目录失败（errno ${res.errno}）`)
  return res.list ?? []
}

async function deleteFiles(cookie: string, bdstoken: string, filelist: string[]): Promise<number> {
  if (filelist.length === 0) return 0
  const res = await fetchJson<FilemanagerResp>(
    `https://pan.baidu.com/api/filemanager?async=2&web=1&app_id=250528&channel=chunlei&clienttype=0&bdstoken=${encodeURIComponent(bdstoken)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
        Referer: 'https://pan.baidu.com/disk/home',
      },
      body: new URLSearchParams({
        filelist: JSON.stringify(filelist),
        method: 'delete',
      }).toString(),
    },
  )
  if (res.errno !== 0) throw new Error(`删除文件失败（errno ${res.errno}）`)
  return filelist.length
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  // 并发锁：同一时间只允许一个清理任务运行
  const existing = await env.FLYLIST_KV.get(CLEANUP_LOCK_KEY)
  if (existing) {
    return Response.json({ ok: true, skipped: true, reason: 'another cleanup is running' })
  }
  await env.FLYLIST_KV.put(CLEANUP_LOCK_KEY, String(Date.now()), { expirationTtl: CLEANUP_LOCK_TTL })

  const result: Record<string, unknown> = { ok: true, accounts: [] }
  try {
    const config = await getSiteConfig(env)
    const accounts = (config.baiduAccounts ?? []).filter((a) => a.status === 'normal')

    for (const account of accounts) {
      const accountResult: Record<string, unknown> = { id: account.id, deleted: 0 }
      try {
        const bdstoken = await getBdsToken(account.cookie)
        const files = await listParseDir(account.cookie, bdstoken)
        const now = Date.now()
        const toDelete: string[] = []

        for (const file of files) {
          if (Number(file.isdir) === 1) continue
          const fsId = String(file.fs_id)
          // 下载代理每次成功取流都会刷新这个 key 的时间戳
          const lastDownload = await env.FLYLIST_KV.get(`baidudl:${account.id}:${fsId}`)
          const lastUsed = lastDownload ? Number(lastDownload) : 0
          // 从未下载过的文件以「文件在网盘里的修改时间」近似转存时间不可得，
          // 因此用 KV 里转存缓存的写入时间兜底：查不到下载记录且查不到缓存时跳过（保守不删）
          if (!lastUsed) {
            const transferTs = await env.FLYLIST_KV.get(`baidudlts:${account.id}:${fsId}`)
            if (!transferTs) continue
            if (now - Number(transferTs) < UNUSED_AFTER_MS) continue
          } else if (now - lastUsed < UNUSED_AFTER_MS) {
            continue
          }
          toDelete.push(file.path)
          // 顺手清掉对应的转存缓存，避免命中已删除文件
          const surlKey = await env.FLYLIST_KV.get(`baidufsmap:${account.id}:${fsId}`)
          if (surlKey) {
            await env.FLYLIST_KV.delete(`transfer:baidutransfer:${surlKey}:${fsId}`)
            await env.FLYLIST_KV.delete(`baidufsmap:${account.id}:${fsId}`)
          }
          await env.FLYLIST_KV.delete(`baidudl:${account.id}:${fsId}`)
          await env.FLYLIST_KV.delete(`baidudlts:${account.id}:${fsId}`)
        }

        if (toDelete.length > 0) {
          accountResult.deleted = await deleteFiles(account.cookie, bdstoken, toDelete)
        }
        accountResult.total = files.length
      } catch (error) {
        accountResult.error = error instanceof Error ? error.message : String(error)
      }
      ;(result.accounts as unknown[]).push(accountResult)
    }
  } finally {
    await env.FLYLIST_KV.delete(CLEANUP_LOCK_KEY)
  }

  return Response.json(result)
}
