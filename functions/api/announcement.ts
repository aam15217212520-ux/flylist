import type { Env } from './parsers/shared/types'
import { getSiteConfig } from './parsers/shared/config'

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const config = await getSiteConfig(env)
  const announcement = config.announcement

  return Response.json({
    success: true,
    data: {
      content: announcement?.content ?? '',
      enabled: Boolean(announcement?.enabled && announcement.content?.trim()),
    },
  })
}
