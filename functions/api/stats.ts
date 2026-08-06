import type { Env } from './parsers/shared/types'

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const [total, daily, lanzou, chengtong, feiji, pan123, baidu] = await Promise.all([
    env.FLYLIST_KV.get('stats:total'),
    env.FLYLIST_KV.get(`stats:daily:${today}`),
    env.FLYLIST_KV.get('stats:pan:lanzou'),
    env.FLYLIST_KV.get('stats:pan:chengtong'),
    env.FLYLIST_KV.get('stats:pan:feiji'),
    env.FLYLIST_KV.get('stats:pan:pan123'),
    env.FLYLIST_KV.get('stats:pan:baidu'),
  ])

  return Response.json({
    success: true,
    data: {
      total: Number(total ?? 0),
      today: Number(daily ?? 0),
      byPan: {
        lanzou: Number(lanzou ?? 0),
        chengtong: Number(chengtong ?? 0),
        feiji: Number(feiji ?? 0),
        pan123: Number(pan123 ?? 0),
        baidu: Number(baidu ?? 0),
      },
    },
  })
}
