export type PanType = 'lanzou' | 'chengtong' | 'feiji' | 'pan123' | 'baidu' | 'quark' | 'gdrive' | 'ilanzou' | 'aliyun'

const HOST_RULES: Array<{ type: PanType; test: RegExp }> = [
  // ilanzou 规则要放在 lanzou 前面：lanzou 的正则没有锚定开头，会把 "ilanzou.com" 也误判成蓝奏云
  { type: 'ilanzou', test: /ilanzou\.com/i },
  { type: 'lanzou', test: /lanzo[a-z]{1,3}\.(com|net|org|space)/i },
  { type: 'chengtong', test: /ctfile\.com/i },
  { type: 'feiji', test: /feijipan\.com|feijix\.com/i },
  { type: 'pan123', test: /123pan\.(com|cn)|123684\.com|123865\.com|123912\.com/i },
  { type: 'baidu', test: /pan\.baidu\.com|yun\.baidu\.com/i },
  { type: 'quark', test: /pan\.quark\.cn/i },
  { type: 'gdrive', test: /drive\.google\.com|docs\.google\.com/i },
  { type: 'aliyun', test: /alipan\.com|aliyundrive\.com/i },
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
  gdrive: 'Google Drive',
  ilanzou: '蓝奏云优享版',
  aliyun: '阿里云盘',
}
