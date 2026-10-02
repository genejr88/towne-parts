import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { PackageSearch, X, ExternalLink, Search } from 'lucide-react'
import { partsApi } from '@/lib/api'
import { urgency, TONE, chaseStatus, daysOut, partialLabel, fmtDay } from '@/lib/chase'
import Spinner from '@/components/ui/Spinner'
import PartFollowUp from '@/components/PartFollowUp'

const FILTERS = [
  { key: 'all',   label: 'All' },
  { key: 'late',  label: 'Late' },
  { key: 'soon',  label: 'Due soon' },
  { key: 'noeta', label: 'No ETA' },
  { key: 'order', label: 'Need to order' },
]

const vehicleOf = (ro) => [ro.vehicleYear, ro.vehicleMake, ro.vehicleModel].filter(Boolean).join(' ')

// Every part not here yet, across all open ROs, most urgent first.
export default function StillOut() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [vendor, setVendor] = useState('')
  const [term, setTerm] = useState('')
  const [openId, setOpenId] = useState(null)

  const { data: parts = [], isLoading } = useQuery({
    queryKey: ['still-out'],
    queryFn: () => partsApi.stillOut(),
    refetchInterval: 60_000,
  })

  const rows = useMemo(() => parts
    .map((p) => ({ ...p, u: urgency(p) }))
    .sort((a, b) => a.u.rank - b.u.rank || daysOut(b) - daysOut(a)), [parts])

  const counts = useMemo(() => {
    const c = { all: rows.length, late: 0, soon: 0, noeta: 0, order: 0 }
    for (const r of rows) if (c[r.u.key] !== undefined) c[r.u.key]++
    return c
  }, [rows])

  const vendors = useMemo(() => [...new Set(rows.map((r) => r.ro.vendor?.name).filter(Boolean))].sort(), [rows])

  const t = term.trim().toLowerCase()
  const shown = rows.filter((r) =>
    (filter === 'all' || r.u.key === filter) &&
    (!vendor || r.ro.vendor?.name === vendor) &&
    (!t || [r.ro.roNumber, r.partNumber, r.description, vehicleOf(r.ro)].some((v) => String(v || '').toLowerCase().includes(t))))

  const open = rows.find((r) => r.id === openId)
  const roCount = new Set(rows.map((r) => r.roId)).size

  return (
    <div className="flex flex-col h-full">
      <div className="bg-gray-950/95 backdrop-blur-sm px-4 pt-3 pb-3 sticky top-0 z-10 border-b border-gray-800/60">
        <div className="flex items-center gap-2 mb-3">
          <PackageSearch size={18} className="text-amber-400 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-base font-bold text-gray-100 leading-none">Still Out</h1>
            <p className="text-xs text-gray-500 mt-1">{rows.length} part{rows.length === 1 ? '' : 's'} across {roCount} RO{roCount === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                filter === f.key
                  ? f.key === 'late' ? TONE.red : f.key === 'soon' ? TONE.amber : f.key === 'order' ? TONE.violet : 'bg-blue-500/15 text-blue-300 border-blue-500/40'
                  : 'bg-gray-900 text-gray-400 border-gray-800 hover:text-gray-200'
              }`}
            >
              {f.label} <span className="opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="RO, part #, vehicle"
              className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <select
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-2 text-sm text-gray-300 focus:outline-none max-w-[45%]"
          >
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 pb-28">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-gray-400">{rows.length ? 'Nothing matches that filter.' : 'Every part is here.'}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 overflow-hidden divide-y divide-gray-800">
            {shown.map((r) => {
              const st = chaseStatus(r.chaseStatus)
              const partial = partialLabel(r)
              return (
                <button
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className={`w-full text-left px-3.5 py-3 flex items-start gap-3 hover:bg-gray-900/70 transition-colors ${openId === r.id ? 'bg-gray-900' : 'bg-gray-950'}`}
                >
                  <div className="w-14 shrink-0">
                    <div className="text-sm font-bold text-gray-100 font-mono">{r.ro.roNumber}</div>
                    <div className="text-[10px] text-gray-600 truncate">{r.ro.vehicleMake || ''}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-100 truncate">{r.description || r.partNumber || 'Part'}{r.qty > 1 ? <span className="text-gray-500"> ×{r.qty}</span> : null}</div>
                    <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                      {r.partNumber && <span className="font-mono">{r.partNumber}</span>}
                      {r.ro.vendor?.name && <span>{r.ro.vendor.name}</span>}
                      <span className={`px-1.5 rounded border text-[10px] font-semibold ${st.chip}`}>{st.label}</span>
                      {partial && <span className="text-emerald-400">{partial}</span>}
                    </div>
                    {r.notes && <div className="text-xs text-gray-400 mt-1 truncate">“{r.notes}”</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-semibold ${TONE[r.u.tone]}`}>{r.u.label}</span>
                    <div className="text-[10px] text-gray-600 mt-1">{r.dateOrdered ? `ordered ${fmtDay(r.dateOrdered)}` : 'added'} · {daysOut(r)}d</div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Follow-up drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpenId(null)}
              className="fixed inset-0 z-40 bg-black/60"
            />
            <motion.aside
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-gray-950 border-l border-gray-800 overflow-y-auto"
            >
              <div className="p-4 border-b border-gray-800 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-500">RO {open.ro.roNumber} · {vehicleOf(open.ro)}</div>
                  <div className="text-base font-semibold text-gray-100 mt-0.5">{open.description || open.partNumber || 'Part'}</div>
                  <div className="text-xs text-gray-500 mt-0.5 font-mono">{open.partNumber}{open.qty > 1 ? ` · qty ${open.qty}` : ''}</div>
                </div>
                <button onClick={() => setOpenId(null)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800" aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <button
                  onClick={() => navigate(`/ros/${open.roId}`)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-700 text-sm font-semibold text-gray-200 hover:bg-gray-900"
                >
                  <ExternalLink size={14} /> Open RO {open.ro.roNumber} to check it in
                </button>
                <PartFollowUp key={open.id} part={open} roId={open.roId} />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
