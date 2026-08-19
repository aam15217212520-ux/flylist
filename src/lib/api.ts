export interface ParseResultData {
  panType: string
  panName: string
  fileName?: string
  fileSize?: string
  directLink: string
  cacheHit?: boolean
  /** 仅百度网盘会带这个字段：直链要求下载方 User-Agent 精确匹配此值，
   * 浏览器无法直接下载，需引导用户用 IDM 等工具手动填入该 UA 后下载。 */
  requiredUA?: string
}

export interface ParseFolderFile {
  fileId: string
  fileName: string
  fileSize?: string
  url: string
}

export interface ParseFolderData {
  panType: string
  panName: string
  folderName?: string
  files: ParseFolderFile[]
}

export interface ParseResult {
  success: boolean
  message?: string
  data?: ParseResultData
  isFolder?: boolean
  folder?: ParseFolderData
  fallbackUrl?: string
}

export async function parseShareLink(url: string, pwd: string): Promise<ParseResult> {
  const res = await fetch('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, pwd }),
  })
  const json = await res.json()
  if (json.isFolder) {
    return { success: true, isFolder: true, folder: json.data }
  }
  return json
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
