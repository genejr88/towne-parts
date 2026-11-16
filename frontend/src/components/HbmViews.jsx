import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Eye, X } from 'lucide-react'
import { productionApi } from '@/lib/api'

// Call from the HBM board: records the visit. The server only keeps visits by the HBM account.
export function useLogHbmView(hbmOnly) {
  const { pathname } = useLocation()
  useEffect(() => {
    if (hbmOnly) productionApi.logHbmView(pathname).catch(() => {})
  }, [hbmOnly, pathname])
}

const when = (d) => new Date(d).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const ago = (d) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`
  const days = Math.round(h / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// Main board: eye button with today's count; opens the full log. Refreshes every 20s.
export function HbmViewsButton() {
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['hbm-views'],
    queryFn: () => productionApi.hbmViews(200),
    refetchInterval: 20_000,
  })

  // Group the log by day
  const days = []
  for (const v of data?.views || []) {
    const day = new Date(v.createdAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, items: [] })
    days[days.length - 1].items.push(v)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative flex items-center gap-1.5 text-xs text-pink-300 hover:text-pink-200 px-2 py-1 rounded-lg bg-pink-950/40 border border-pink-900/50 transition-colors"
        title={data?.last ? `HBM last viewed the HBM board ${ago(data.last)}` : 'HBM board views'}
      >
        <Eye size={13} />
        {data ? data.today : '–'}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/60" />
            <motion.aside
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-sm bg-gray-950 border-l border-gray-800 flex flex-col"
            >
              <div className="p-4 border-b border-gray-800 flex items-start gap-3">
                <Eye size={18} className="text-pink-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-base font-bold text-gray-100">HBM board views</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {data?.last ? `Last viewed ${ago(data.last)} · ${when(data.last)}` : 'The HBM account hasn’t opened the HBM board yet.'}
                  </p>
                </div>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800" aria-label="Close"><X size={18} /></button>
              </div>
              <div className="grid grid-cols-3 gap-2 p-4 border-b border-gray-800">
                {[['Today', data?.today], ['Last 7 days', data?.week], ['All time', data?.total]].map(([label, n]) => (
                  <div key={label} className="rounded-xl bg-gray-900 border border-gray-800 px-3 py-2.5">
                    <p className="text-xl font-bold text-gray-100">{n ?? '–'}</p>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {days.map((g) => (
                  <div key={g.day}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">{g.day} · {g.items.length} view{g.items.length === 1 ? '' : 's'}</p>
                    <ol className="space-y-1">
                      {g.items.map((v) => (
                        <li key={v.id} className="flex items-center justify-between text-sm text-gray-300 px-2.5 py-1.5 rounded-lg bg-gray-900/60">
                          <span>{new Date(v.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                          <span className="text-[11px] text-gray-600">{v.page && v.page !== '/board/hbm' ? v.page.replace('/board/', '').replace('/hbm', '') + ' board' : ''}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
                {data && !days.length && <p className="text-sm text-gray-500 text-center py-8">No views yet.</p>}
              </div>
              <p className="px-4 py-3 text-[11px] text-gray-600 border-t border-gray-800">Counts each time the HBM account opens the HBM board. Reloading within a minute counts once.</p>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
