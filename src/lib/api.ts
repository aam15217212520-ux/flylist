export interface ParseResultData {
  panType: string
  panName: string
  fileName?: string
  fileSize?: string
  directLink: string
  cacheHit?: boolean
}

export interface ParseResult {
  success: boolean
  message?: string
  data?: ParseResultData
  fallbackUrl?: string
}

export async function parseShareLink(url: string, pwd: string): Promise<ParseResult> {
  const res = await fetch('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, pwd }),
  })
  return res.json()
}

export interface StatsData {
  total: number
  today: number
  byPan: Record<string, number>
}

export interface StatsResult {
  success: boolean
  data?: StatsData
}

export async function fetchStats(): Promise<StatsResult> {
  const res = await fetch('/api/stats')
  return res.json()
}

export interface AnnouncementData {
  content: string
  enabled: boolean
}

export interface AnnouncementResult {
  success: boolean
  data?: AnnouncementData
}

export async function fetchAnnouncement(): Promise<AnnouncementResult> {
  const res = await fetch('/api/announcement')
  return res.json()
}
