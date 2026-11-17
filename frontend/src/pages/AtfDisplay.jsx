import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

// Shop TV screen for after-the-fact part orders: /atf-display?key=<ATF_DISPLAY_KEY>
// Full screen, no login (a login would expire on an always-on PC), refreshes every 20 s, keeps the
// screen awake, and pages through the list if it's longer than one screen. Read-only.
// Order: not ordered → ordered (oldest request first) → arrived today.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002'
const REFRESH_MS = 20_000
const PAGE_MS = 12_000

// The key is remembered on the PC the first time the link is opened, so the installed app can start
// at plain /atf-display (the manifest can't carry the secret key).
const KEY_STORE = 'atf_display_key'
function displayKey() {
  const fromUrl = new URLSearchParams(window.location.search).get('key') || ''
  try {
    if (fromUrl) localStorage.setItem(KEY_STORE, fromUrl)
    return fromUrl || localStorage.getItem(KEY_STORE) || ''
  } catch { return fromUrl }
}

// "Install as an app" (Edge/Chrome): this page alone links public/atf.webmanifest, so only the TV
// screen installs — not the rest of Towne Parts. The browser hands over a one-shot install prompt.
function useInstall() {
  const [prompt, setPrompt] = useState(null)
  const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e) }
    const onDone = () => setPrompt(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onDone)
    const link = Object.assign(document.createElement('link'), { rel: 'manifest', href: '/atf.webmanifest' })
    document.head.appendChild(link)
    const prevTitle = document.title
    document.title = 'ATF Parts'
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onDone)
      link.remove(); document.title = prevTitle
    }
  }, [])
  const install = async () => {
    const e = prompt; setPrompt(null)
    try { e?.prompt(); await e?.userChoice } catch { /* closed: Edge's menu > Apps > Install still works */ }
  }
  return { canInstall: !!prompt && !standalone, install }
}

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
  const key = useMemo(displayKey, [])
  const { canInstall, install } = useInstall()
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
  // Size everything from the window: a full TV gets the wide table, a small tile (e.g. a corner of a
  // split screen) gets compact rows. Everything below is in em, so it scales with baseFont.
  const [win, setWin] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const on = () => setWin({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    // Belt and braces: some always-on PCs don't deliver resize events to a background window
    const id = setInterval(() => setWin((p) => (p.w === window.innerWidth && p.h === window.innerHeight ? p : { w: window.innerWidth, h: window.innerHeight })), 3000)
    return () => { window.removeEventListener('resize', on); clearInterval(id) }
  }, [])
  const compact = win.w < 1000
  const baseFont = compact
    ? Math.max(10, Math.min(26, win.w / 34, win.h / 32))
    : Math.min(win.w * 0.015, win.h * 0.027)
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

  // Tap a photo → that tech's profile; tap a part → its details. Closes itself after 30 s so the
  // TV never gets stuck on a pop-up; paging pauses while one is open.
  const [open, setOpen] = useState(null) // { kind: 'tech' | 'part', id }
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setOpen(null), 30_000)
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [open])
  const openItem = open && (items || []).find((i) => i.id === open.id)

  // Page through long lists
  const pages = Math.max(1, Math.ceil((items?.length || 0) / perPage))
  useEffect(() => { if (page >= pages) setPage(0) }, [page, pages])
  useEffect(() => {
    if (pages < 2 || open) return
    const id = setInterval(() => setPage((p) => (p + 1) % pages), PAGE_MS)
    return () => clearInterval(id)
  }, [pages, open])

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
    nokey: 'This screen needs its display link (with the key at the end). Copy it from Towne Control → TV Links.',
    badkey: 'The display key in this link is wrong or has been changed. Copy the current link from Towne Control → TV Links.',
    off: 'The after-the-fact display isn’t switched on in Towne Parts yet.',
  }[error]

  const counts = [['NOT_ORDERED', 'to order'], ['ORDERED', 'on the way'], ['HERE', 'here today']]

  return (
    <div
      className={`h-[100dvh] overflow-hidden bg-gray-950 text-gray-100 flex flex-col ${cursorHidden ? 'cursor-none' : ''}`}
      style={{ fontSize: `${baseFont}px` }}
      onMouseMove={wake}
    >
      {/* Header */}
      {compact ? (
        <header className="flex items-center justify-between gap-[0.8em] px-[0.9em] pt-[0.7em] pb-[0.55em] border-b border-gray-800">
          <div className="min-w-0">
            <p className="text-[0.62em] font-bold uppercase tracking-[0.25em] text-amber-400 leading-none">After-the-fact parts</p>
            <div className="flex items-center gap-[0.9em] mt-[0.35em]">
              {counts.map(([s, label]) => (
                <span key={s} className="flex items-baseline gap-[0.3em] whitespace-nowrap">
                  <span className={`inline-block w-[0.55em] h-[0.55em] rounded-full self-center ${STATUS[s].bar}`} />
                  <b className="text-[1.25em] font-black tabular-nums leading-none">{items ? count(s) : '–'}</b>
                  <span className="text-[0.68em] text-gray-500 font-semibold uppercase tracking-wide">{label}</span>
                </span>
              ))}
            </div>
          </div>
          <p className="text-[1.35em] font-black tabular-nums leading-none text-gray-300 shrink-0">{time(now)}</p>
        </header>
      ) : (
        <header className="flex items-end justify-between px-[2em] pt-[1.3em] pb-[0.9em] border-b border-gray-800">
          <div>
            <p className="text-[0.8em] font-bold uppercase tracking-[0.3em] text-amber-400">Towne Body Shop</p>
            <h1 className="text-[2.4em] font-black leading-none tracking-tight mt-[0.15em]">After-the-fact parts</h1>
          </div>
          <div className="flex items-end gap-[1.6em]">
            {counts.map(([s, label]) => (
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
      )}

      {/* List */}
      <main className={`flex-1 min-h-0 ${compact ? 'px-[0.6em] py-[0.55em]' : 'px-[2em] py-[1em]'}`}>
        {message ? (
          <div className="h-full grid place-items-center text-center"><p className="text-[1.2em] text-gray-400 max-w-[30em] px-[1em]">{message}</p></div>
        ) : !items ? (
          <div className="h-full grid place-items-center"><p className="text-[1.3em] text-gray-500">Loading…</p></div>
        ) : !items.length ? (
          <div className="h-full grid place-items-center text-center">
            <div>
              <p className={`${compact ? 'text-[2em]' : 'text-[3em]'} font-black text-gray-300`}>Nothing waiting</p>
              <p className="text-[1.05em] text-gray-500 mt-[0.3em]">No after-the-fact parts on order right now.</p>
            </div>
          </div>
        ) : compact ? (
          <ol ref={listRef} className="h-full overflow-hidden space-y-[0.4em]">
            {shown.map((i) => (
              <li
                key={i.id}
                onClick={() => setOpen({ kind: 'part', id: i.id })}
                className={`relative flex items-center gap-[0.65em] rounded-[0.6em] bg-gray-900 border border-gray-800 pl-[0.75em] pr-[0.6em] py-[0.45em] overflow-hidden cursor-pointer hover:border-gray-600 ${i.status === 'HERE' ? 'opacity-60' : ''}`}
              >
                <span className={`absolute left-0 top-0 bottom-0 w-[0.28em] ${STATUS[i.status].bar}`} />
                <button onClick={(e) => { e.stopPropagation(); setOpen({ kind: 'tech', id: i.id }) }} className="shrink-0 rounded-full" title={`About ${i.tech}`}>
                  <Avatar name={i.tech} photo={i.techPhoto} size="2.7em" />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-[0.5em] min-w-0">
                    <span className="font-mono text-[1.2em] font-black tabular-nums leading-none shrink-0">{i.roNumber}</span>
                    <span className="text-[0.98em] font-bold truncate leading-tight">
                      {i.part}{i.qty > 1 && <span className="text-gray-400 font-semibold"> ×{i.qty}</span>}
                    </span>
                  </div>
                  <p className="text-[0.72em] text-gray-500 truncate leading-tight mt-[0.2em]">
                    <span className="text-gray-300 font-semibold">{i.tech || '—'}</span>
                    {i.status === 'HERE' && i.receivedAt ? ` · arrived ${time(i.receivedAt)}` : ` · ${ago(i.requestedAt)} ago`}
                    {i.backordered ? ' · backordered' : ''}
                    {i.vehicle ? ` · ${i.vehicle}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 rounded-[0.4em] px-[0.5em] py-[0.25em] text-[0.68em] font-black uppercase tracking-wide whitespace-nowrap ${STATUS[i.status].pill}`}>
                  {STATUS[i.status].label}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="h-full flex flex-col">
            <div className="grid grid-cols-[6em_minmax(0,1fr)_11em_9.5em] gap-[1.2em] px-[1em] pb-[0.5em] text-[0.75em] font-bold uppercase tracking-[0.2em] text-gray-500">
              <span>RO</span><span>Part</span><span>Tech</span><span className="text-right">Status</span>
            </div>
            <ol ref={listRef} className="flex-1 min-h-0 overflow-hidden space-y-[0.35em]">
              {shown.map((i) => (
                <li
                  key={i.id}
                  onClick={() => setOpen({ kind: 'part', id: i.id })}
                  className={`relative grid grid-cols-[6em_minmax(0,1fr)_11em_9.5em] gap-[1.2em] items-center rounded-[0.6em] bg-gray-900 border border-gray-800 pl-[1em] pr-[1em] py-[0.35em] overflow-hidden cursor-pointer hover:border-gray-600 ${i.status === 'HERE' ? 'opacity-60' : ''}`}
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
                  <button onClick={(e) => { e.stopPropagation(); setOpen({ kind: 'tech', id: i.id }) }} className="flex items-center gap-[0.55em] min-w-0 text-left" title={`About ${i.tech}`}>
                    <Avatar name={i.tech} photo={i.techPhoto} size="2.3em" />
                    <span className="text-[1.2em] font-semibold truncate">{i.tech || '—'}</span>
                  </button>
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
      <footer className={`flex items-center justify-between gap-[1em] ${compact ? 'px-[0.9em] pb-[0.5em] text-[0.65em]' : 'px-[2em] pb-[1em] text-[0.8em]'} text-gray-600`}>
        <span className="truncate">
          {error === 'offline' && lastOk ? `Can’t reach Towne Parts — showing ${time(lastOk)}` : lastOk ? `Updated ${time(lastOk)}` : ''}
        </span>
        {canInstall && !cursorHidden && (
          <button
            onClick={install}
            className="shrink-0 rounded-[0.5em] border border-gray-700 bg-gray-900 px-[1em] py-[0.45em] text-[1.1em] font-semibold text-gray-200 hover:bg-gray-800"
          >
            Install as an app
          </button>
        )}
        {pages > 1 && (
          <span className="flex items-center gap-[0.5em] shrink-0">
            {Array.from({ length: pages }, (_, p) => (
              <span key={p} className={`h-[0.5em] rounded-full transition-all ${p === page ? 'w-[1.6em] bg-gray-300' : 'w-[0.5em] bg-gray-700'}`} />
            ))}
            <span className="ml-[0.4em]">{page + 1}/{pages}</span>
          </span>
        )}
      </footer>

      {openItem && (
        <div className="fixed inset-0 z-50 bg-black/75 grid place-items-center p-[1em]" onClick={() => setOpen(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[34em] max-h-full overflow-y-auto rounded-[1em] bg-gray-900 border border-gray-700 shadow-2xl p-[1.3em]"
          >
            <button onClick={() => setOpen(null)} className="absolute top-[0.6em] right-[0.8em] text-[1.6em] leading-none text-gray-500 hover:text-gray-200" aria-label="Close">×</button>
            {open.kind === 'tech'
              ? <TechProfile item={openItem} waiting={(items || []).filter((x) => x.tech === openItem.tech && x.status !== 'HERE').length} />
              : <PartDetail item={openItem} onTech={() => setOpen({ kind: 'tech', id: openItem.id })} />}
          </div>
        </div>
      )}
    </div>
  )
}

function TechProfile({ item, waiting }) {
  const p = item.techProfile || {}
  const year = /^\d{4}$/.test(String(p.since || '').trim()) ? +p.since : null
  const years = year ? new Date().getFullYear() - year : null
  const chips = String(p.specialties || '').split(',').map((s) => s.trim()).filter(Boolean)
  return (
    <div>
      <div className="flex items-center gap-[1em]">
        <Avatar name={item.tech} photo={item.techPhotoLarge || item.techPhoto} size="6.5em" />
        <div className="min-w-0">
          <p className="text-[2em] font-black leading-none truncate">{item.tech}</p>
          {p.role && <p className="text-[1.05em] text-amber-400 font-semibold mt-[0.3em]">{p.role}</p>}
          {p.since && (
            <p className="text-[0.85em] text-gray-400 mt-[0.2em]">
              At Towne since {p.since}{years != null && years >= 1 ? ` · ${years} year${years === 1 ? '' : 's'}` : ''}
            </p>
          )}
        </div>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-[0.4em] mt-[1em]">
          {chips.map((c) => <span key={c} className="rounded-full bg-gray-800 border border-gray-700 px-[0.75em] py-[0.25em] text-[0.8em] font-semibold text-gray-200">{c}</span>)}
        </div>
      )}
      {p.about && <p className="text-[0.95em] text-gray-200 leading-snug mt-[1em] whitespace-pre-line">{p.about}</p>}
      {p.funFact && (
        <div className="mt-[1em] rounded-[0.6em] bg-amber-400/10 border border-amber-400/30 px-[0.9em] py-[0.6em]">
          <p className="text-[0.65em] font-bold uppercase tracking-[0.2em] text-amber-400">Fun fact</p>
          <p className="text-[0.95em] text-gray-100 mt-[0.2em] whitespace-pre-line">{p.funFact}</p>
        </div>
      )}
      {p.languages && <p className="text-[0.8em] text-gray-400 mt-[0.9em]">Speaks {p.languages}</p>}
      {!item.techProfile && <p className="text-[0.85em] text-gray-500 mt-[1em]">No profile yet. Add one in Towne Parts → Admin → Technicians.</p>}
      <p className="text-[0.8em] text-gray-500 mt-[1em] pt-[0.8em] border-t border-gray-800">
        {waiting ? `Waiting on ${waiting} after-the-fact part${waiting === 1 ? '' : 's'} right now` : 'Nothing on order for them right now'}
      </p>
    </div>
  )
}

const longWhen = (d) => (d ? new Date(d).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null)
const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) : null)

function PartDetail({ item, onTech }) {
  const make = String(item.vehicle || '').split(' ')[1] || ''
  // Google Images for the part #, with the make to cut out other brands' parts that share a number
  const searchUrl = item.partNumber
    ? `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${item.partNumber} ${make}`.trim())}`
    : null
  const rows = [
    ['Asked', longWhen(item.requestedAt)],
    ['Ordered', shortDate(item.orderedAt)],
    ['ETA', item.status !== 'HERE' ? shortDate(item.etaDate) : null],
    ['Arrived', longWhen(item.receivedAt)],
  ].filter(([, v]) => v)
  return (
    <div>
      <div className="flex items-start justify-between gap-[1em] pr-[1.5em]">
        <div className="min-w-0">
          <p className="font-mono text-[1.1em] font-black text-gray-400">RO {item.roNumber}</p>
          <p className="text-[1.6em] font-black leading-tight mt-[0.1em]">
            {item.part}{item.qty > 1 && <span className="text-gray-400"> ×{item.qty}</span>}
          </p>
          {item.vehicle && <p className="text-[0.9em] text-gray-400 mt-[0.2em]">{item.vehicle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-[0.6em] mt-[0.8em] flex-wrap">
        <span className={`rounded-[0.4em] px-[0.6em] py-[0.25em] text-[0.8em] font-black uppercase tracking-wide ${STATUS[item.status].pill}`}>{STATUS[item.status].label}</span>
        {item.backordered && <span className="rounded-[0.4em] px-[0.6em] py-[0.25em] text-[0.8em] font-bold uppercase bg-gray-800 text-gray-300">Backordered</span>}
        {item.qty > 1 && item.qtyReceived > 0 && item.status !== 'HERE' && <span className="text-[0.85em] text-gray-400">{item.qtyReceived} of {item.qty} here</span>}
      </div>
      {item.partNumber && (
        <p className="mt-[0.9em] text-[0.85em] text-gray-400">Part # <span className="font-mono text-[1.15em] font-bold text-gray-100 select-all">{item.partNumber}</span></p>
      )}
      <dl className="mt-[0.8em] grid grid-cols-[6em_minmax(0,1fr)] gap-y-[0.25em] text-[0.88em]">
        {rows.map(([k, v]) => <Fragment key={k}><dt className="text-gray-500">{k}</dt><dd className="text-gray-200">{v}</dd></Fragment>)}
      </dl>
      <button onClick={onTech} className="mt-[1em] flex items-center gap-[0.6em] rounded-[0.6em] bg-gray-800/70 hover:bg-gray-800 px-[0.7em] py-[0.45em] w-full text-left">
        <Avatar name={item.tech} photo={item.techPhoto} size="2.2em" />
        <span className="text-[0.9em] text-gray-300">Asked for by <b className="text-gray-100">{item.tech || '—'}</b></span>
      </button>
      {searchUrl ? (
        <a
          href={searchUrl} target="_blank" rel="noopener noreferrer"
          className="mt-[0.8em] flex items-center justify-center gap-[0.5em] rounded-[0.6em] bg-blue-600 hover:bg-blue-500 py-[0.7em] text-[1em] font-bold text-white"
        >
          Search Google Images for {item.partNumber}
        </a>
      ) : (
        <p className="mt-[0.8em] text-[0.8em] text-gray-500">No part # entered — add one on the RO to get a picture search.</p>
      )}
    </div>
  )
}

// Tech headshot (from Towne Tools), or a coloured initials badge when there's no photo
const AVATAR_COLORS = ['#0ea5e9', '#8b5cf6', '#f97316', '#14b8a6', '#ec4899', '#84cc16', '#6366f1', '#eab308']
function Avatar({ name, photo, size }) {
  const [broken, setBroken] = useState(false)
  const n = String(name || '').trim()
  const initials = n ? n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : '?'
  const color = AVATAR_COLORS[[...n].reduce((h, c) => h + c.charCodeAt(0), 0) % AVATAR_COLORS.length]
  // Size in the parent's em; the initials get their own font size inside (setting it on the box
  // itself would make the box's em-based width grow with it)
  const box = { width: size, height: size }
  if (photo && !broken) {
    return <img src={photo} alt={n} onError={() => setBroken(true)} style={box} className="shrink-0 rounded-full object-cover ring-2 ring-gray-700 bg-gray-800" />
  }
  return (
    <span style={{ ...box, background: color }} className="shrink-0 rounded-full grid place-items-center font-black text-white ring-2 ring-gray-700">
      <span style={{ fontSize: `calc(${size} * 0.4)` }} className="leading-none">{initials}</span>
    </span>
  )
}
