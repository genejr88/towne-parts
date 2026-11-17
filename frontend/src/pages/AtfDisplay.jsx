import { useEffect, useMemo, useRef, useState } from 'react'

// Shop TV screen for after-the-fact part orders: /atf-display?key=<ATF_DISPLAY_KEY>
// Full screen, no login (a login would expire on an always-on PC), refreshes every 20 s, keeps the
// screen awake, and pages through the list if it's longer than one screen. Read-only.
// Order: not ordered → ordered (oldest request first) → arrived today.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002'
const REFRESH_MS = 20_000
const PAGE_MS = 12_000

const STATUS = {
  NOT_ORDERED: { label: 'Not ordered', pill: 'bg-red-600 text-white', bar: 'bg-red-500' },
  ORDERED: { label: 'Ordered', pill: 'bg-amber-400 text-amber-950', bar: 'bg-amber-400' },
  HERE: { label: 'Here', pill: 'bg-emerald-500 text-emerald-950', bar: 'bg-emerald-500' },
}

const ago = (d) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000))
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr`
  const days = Math.round(h / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}
const time = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

export default function AtfDisplay() {
  const key = useMemo(() => new URLSearchParams(window.location.search).get('key') || '', [])
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null) // 'nokey' | 'badkey' | 'off' | 'offline'
  const [lastOk, setLastOk] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [page, setPage] = useState(0)
  const [cursorHidden, setCursorHidden] = useState(false)
  const hideTimer = useRef(null)
  // Rows per page = however many fit on this screen (measured, re-measured on resize)
  const listRef = useRef(null)
  const [perPage, setPerPage] = useState(6)
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = () => {
      const rows = el.querySelectorAll('li')
      if (!rows.length) return
      // stride = one row plus the space between rows (the first row has no space above it)
      const h = rows[0].getBoundingClientRect().height
      const gap = rows.length > 1 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom : parseFloat(getComputedStyle(el).fontSize) * 0.45
      const fit = Math.max(1, Math.floor((el.clientHeight + gap) / Math.max(h + gap, 1)))
      setPerPage((p) => (p === fit ? p : fit))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  })

  // Load + refresh
  useEffect(() => {
    if (!key) { setError('nokey'); return }
    let alive = true
    const load = async () => {
      try {
        const r = await fetch(`${API_URL}/api/atf/display?key=${encodeURIComponent(key)}`)
        if (r.status === 401) throw Object.assign(new Error(), { code: 'badkey' })
        if (r.status === 404) throw Object.assign(new Error(), { code: 'off' })
        const j = await r.json()
        if (!j.success) throw new Error(j.error)
        if (!alive) return
        setItems(j.data); setError(null); setLastOk(new Date())
      } catch (e) {
        if (alive) setError(e.code || 'offline') // keep showing the last list if we had one
      }
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => { alive = false; clearInterval(id) }
  }, [key])

  // Clock
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(id) }, [])

  // Keep the screen awake (re-request after the tab comes back into view)
  useEffect(() => {
    let lock = null
    const get = async () => { try { lock = await navigator.wakeLock?.request('screen') } catch { /* not allowed: fine */ } }
    const vis = () => { if (document.visibilityState === 'visible') get() }
    get(); document.addEventListener('visibilitychange', vis)
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release?.() }
  }, [])

  // Page through long lists
  const pages = Math.max(1, Math.ceil((items?.length || 0) / perPage))
  useEffect(() => { if (page >= pages) setPage(0) }, [page, pages])
  useEffect(() => {
    if (pages < 2) return
    const id = setInterval(() => setPage((p) => (p + 1) % pages), PAGE_MS)
    return () => clearInterval(id)
  }, [pages])

  // Hide the mouse when idle; F = full screen
  const wake = () => {
    setCursorHidden(false); clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setCursorHidden(true), 4000)
  }
  useEffect(() => {
    wake()
    const onKey = (e) => {
      if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const count = (s) => (items || []).filter((i) => i.status === s).length
  const shown = (items || []).slice(page * perPage, page * perPage + perPage)

  const message = {
    nokey: 'This screen needs its display link (with the key at the end).',
    badkey: 'The display key in this link is wrong or has been changed. Ask Gene for the current link.',
    off: 'The after-the-fact display isn’t switched on in Towne Parts yet.',
  }[error]

  return (
    <div
      className={`h-[100dvh] overflow-hidden bg-gray-950 text-gray-100 flex flex-col ${cursorHidden ? 'cursor-none' : ''}`}
      style={{ fontSize: 'min(1.5vw, 2.7vh)' }}
      onMouseMove={wake}
    >
      {/* Header */}
      <header className="flex items-end justify-between px-[2em] pt-[1.3em] pb-[0.9em] border-b border-gray-800">
        <div>
          <p className="text-[0.8em] font-bold uppercase tracking-[0.3em] text-amber-400">Towne Body Shop</p>
          <h1 className="text-[2.4em] font-black leading-none tracking-tight mt-[0.15em]">After-the-fact parts</h1>
        </div>
        <div className="flex items-end gap-[1.6em]">
          {[['NOT_ORDERED', 'to order'], ['ORDERED', 'on the way'], ['HERE', 'here today']].map(([s, label]) => (
            <div key={s} className="text-right">
              <p className="text-[2.2em] font-black leading-none tabular-nums">{items ? count(s) : '–'}</p>
              <p className="text-[0.75em] font-semibold uppercase tracking-wider text-gray-500 mt-[0.2em] flex items-center justify-end gap-[0.4em]">
                <span className={`inline-block w-[0.6em] h-[0.6em] rounded-full ${STATUS[s].bar}`} />{label}
              </p>
            </div>
          ))}
          <div className="text-right pl-[1.4em] border-l border-gray-800">
            <p className="text-[2.2em] font-black leading-none tabular-nums">{time(now)}</p>
            <p className="text-[0.75em] font-semibold uppercase tracking-wider text-gray-500 mt-[0.2em]">
              {now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>
      </header>

      {/* List */}
      <main className="flex-1 min-h-0 px-[2em] py-[1em]">
        {message ? (
          <div className="h-full grid place-items-center text-center"><p className="text-[1.5em] text-gray-400 max-w-[30em]">{message}</p></div>
        ) : !items ? (
          <div className="h-full grid place-items-center"><p className="text-[1.5em] text-gray-500">Loading…</p></div>
        ) : !items.length ? (
          <div className="h-full grid place-items-center text-center">
            <div>
              <p className="text-[3em] font-black text-gray-300">Nothing waiting</p>
              <p className="text-[1.3em] text-gray-500 mt-[0.3em]">No after-the-fact parts on order right now.</p>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="grid grid-cols-[6em_minmax(0,1fr)_9em_9.5em] gap-[1.2em] px-[1em] pb-[0.5em] text-[0.75em] font-bold uppercase tracking-[0.2em] text-gray-500">
              <span>RO</span><span>Part</span><span>Tech</span><span className="text-right">Status</span>
            </div>
            <ol ref={listRef} className="flex-1 min-h-0 overflow-hidden space-y-[0.35em]">
              {shown.map((i) => (
                <li
                  key={i.id}
                  className={`relative grid grid-cols-[6em_minmax(0,1fr)_9em_9.5em] gap-[1.2em] items-center rounded-[0.6em] bg-gray-900 border border-gray-800 pl-[1em] pr-[1em] py-[0.35em] overflow-hidden ${i.status === 'HERE' ? 'opacity-60' : ''}`}
                >
                  <span className={`absolute left-0 top-0 bottom-0 w-[0.35em] ${STATUS[i.status].bar}`} />
                  <span className="font-mono text-[1.55em] font-black tracking-tight tabular-nums leading-none">{i.roNumber}</span>
                  <div className="min-w-0">
                    <p className="text-[1.25em] font-bold leading-[1.15] line-clamp-2">
                      {i.part}{i.qty > 1 && <span className="text-gray-400 font-semibold"> ×{i.qty}</span>}
                    </p>
                    <p className="text-[0.8em] text-gray-500 truncate leading-tight">
                      {i.vehicle}
                      {i.status === 'HERE' && i.receivedAt ? ` · arrived ${time(i.receivedAt)}` : ` · asked ${ago(i.requestedAt)} ago`}
                      {i.backordered ? ' · backordered' : ''}
                      {i.status !== 'HERE' && i.qty > 1 && i.qtyReceived > 0 ? ` · ${i.qtyReceived} of ${i.qty} here` : ''}
                    </p>
                  </div>
                  <span className="text-[1.25em] font-semibold truncate">{i.tech || '—'}</span>
                  <span className={`justify-self-end rounded-[0.45em] px-[0.7em] py-[0.3em] text-[0.95em] font-black uppercase tracking-wide whitespace-nowrap ${STATUS[i.status].pill}`}>
                    {STATUS[i.status].label}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="flex items-center justify-between px-[2em] pb-[1em] text-[0.8em] text-gray-600">
        <span>
          {error === 'offline' && lastOk ? `Can’t reach Towne Parts — showing the list from ${time(lastOk)}` : lastOk ? `Updated ${time(lastOk)}` : ''}
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-[0.5em]">
            {Array.from({ length: pages }, (_, p) => (
              <span key={p} className={`h-[0.5em] rounded-full transition-all ${p === page ? 'w-[1.6em] bg-gray-300' : 'w-[0.5em] bg-gray-700'}`} />
            ))}
            <span className="ml-[0.4em]">Page {page + 1} of {pages}</span>
          </span>
        )}
      </footer>
    </div>
  )
}
