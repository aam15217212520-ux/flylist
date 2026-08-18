export type PanType = 'lanzou' | 'chengtong' | 'feiji' | 'pan123' | 'baidu' | 'quark'

const HOST_RULES: Array<{ type: PanType; test: RegExp }> = [
  { type: 'lanzou', test: /lanzo[a-z]{1,3}\.(com|net|org|space)/i },
  { type: 'chengtong', test: /ctfile\.com/i },
  { type: 'feiji', test: /feijipan\.com|feijix\.com/i },
  { type: 'pan123', test: /123pan\.(com|cn)|123684\.com|123865\.com|123912\.com/i },
  { type: 'baidu', test: /pan\.baidu\.com|yun\.baidu\.com/i },
  { type: 'quark', test: /pan\.quark\.cn/i },
]

export function detectPanType(url: string): PanType | null {
  try {
    const { hostname } = new URL(url)
    for (const rule of HOST_RULES) {
      if (rule.test.test(hostname)) return rule.type
    }
  } catch {
    return null
  }
  return null
}

export const PAN_NAMES: Record<PanType, string> = {
  lanzou: '蓝奏云',
  chengtong: '城通网盘',
  feiji: '小飞机网盘',
  pan123: '123云盘',
  baidu: '百度网盘',
  quark: '夸克网盘',
}
