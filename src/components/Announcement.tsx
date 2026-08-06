import { useEffect, useState } from 'react'
import { fetchAnnouncement } from '../lib/api'

const DISMISS_KEY = 'flylist_announcement_dismissed_date'

function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function Announcement() {
  const [content, setContent] = useState('')
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    fetchAnnouncement()
      .then((res) => {
        if (!res.success || !res.data?.enabled || !res.data.content.trim()) return
        setContent(res.data.content)
        const dismissedDate = localStorage.getItem(DISMISS_KEY)
        if (dismissedDate !== todayString()) {
          setShowModal(true)
        }
      })
      .catch(() => {})
  }, [])

  if (!content) return null

  function closeOnce() {
    setShowModal(false)
  }

  function dismissForToday() {
    localStorage.setItem(DISMISS_KEY, todayString())
    setShowModal(false)
  }

  return (
    <>
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="max-w-lg w-full bg-panel border border-accent2/30 rounded-lg shadow-glowCyan p-6 font-mono text-sm text-slate-300">
            <h2 className="text-accent2 text-lg mb-4"># 公告</h2>
            <p className="whitespace-pre-wrap leading-relaxed text-slate-300 mb-6">{content}</p>
            <div className="flex gap-3">
              <button
                onClick={closeOnce}
                className="flex-1 py-2 rounded border border-accent text-accent hover:bg-accent hover:text-black transition-colors"
              >
                我知道了
              </button>
              <button
                onClick={dismissForToday}
                className="flex-1 py-2 rounded border border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-200 transition-colors"
              >
                今日不再弹出
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-2xl mx-auto mb-6 px-4 py-2 rounded border border-accent2/30 bg-panel text-xs text-slate-300 font-mono flex items-start gap-2">
        <span className="text-accent2 shrink-0">📢</span>
        <span className="whitespace-pre-wrap">{content}</span>
      </div>
    </>
  )
}
