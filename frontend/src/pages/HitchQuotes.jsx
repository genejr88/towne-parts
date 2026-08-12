import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, RefreshCw, Printer, Trash2, X, CheckCircle2, Link2, Clock } from 'lucide-react'
import { hitchesApi } from '@/lib/api'
import Spinner from '@/components/ui/Spinner'

function fmt$(n) {
  if (n == null) return '—'
  return '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(iso) {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const PRINT_STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; background: #fff; padding: 32px; font-size: 13px; }
  h1 { font-size: 20px; font-weight: 900; letter-spacing: -0.02em; }
  .meta { font-size: 11px; color: #888; margin: 4px 0 24px; }
  .vehicle { font-size: 15px; font-weight: 700; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px; }
  td { padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
  td.amt { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 900; font-size: 16px; border-top: 2px solid #111; border-bottom: none; padding-top: 12px; }
  .customer { margin-top: 24px; font-size: 12px; color: #444; }
  .footer { margin-top: 32px; font-size: 10px; color: #aaa; border-top: 1px solid #e5e7eb; padding-top: 12px; }
  @media print { body { padding: 0; } }
`

function printQuote(q) {
  const win = window.open('', '_blank', 'width=700,height=800')
  if (!win) return
  const tierLabel = {
    RACK_ONLY: 'Rack Only',
    RACK_AND_TOW: 'Rack and Tow',
    RACK_TOW_WIRING: 'Rack and Tow w/ Active Wiring',
  }[q.tier] || q.tier

  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Hitch Quote</title><style>${PRINT_STYLE}</style></head><body>
    <h1>Towne Body Shop — Hitch Quote</h1>
    <div class="meta">${fmtDate(q.createdAt)}${q.createdBy ? ' · Prepared by ' + q.createdBy : ''}</div>
    <div class="vehicle">${q.vehicleTitle}</div>
    <table>
      <tr><td>Hitch Kit</td><td class="amt">${fmt$(q.kitPrice)}</td></tr>
      <tr><td>${tierLabel}</td><td class="amt">${fmt$(q.tierFee)}</td></tr>
      <tr><td>Shipping</td><td class="amt">${fmt$(q.shipping)}</td></tr>
      <tr><td>Tax (${(parseFloat(q.taxRate) * 100).toFixed(2)}%)</td><td class="amt">${fmt$(q.tax)}</td></tr>
      <tr class="total"><td>Total</td><td class="amt">${fmt$(q.total)}</td></tr>
    </table>
    ${q.customerName || q.customerPhone || q.customerEmail ? `
    <div class="customer">
      ${q.customerName ? `<div>${q.customerName}</div>` : ''}
      ${q.customerPhone ? `<div>${q.customerPhone}</div>` : ''}
      ${q.customerEmail ? `<div>${q.customerEmail}</div>` : ''}
    </div>` : ''}
    ${q.notes ? `<div class="customer">${q.notes}</div>` : ''}
    <div class="footer">Towne Body Shop · Authorized Stealth Hitches Installer</div>
  </body></html>`)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 400)
}

const TIER_ORDER = ['RACK_ONLY', 'RACK_AND_TOW', 'RACK_TOW_WIRING']

function NewQuoteTab() {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedKit, setSelectedKit] = useState(null)
  const [tier, setTier] = useState(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState('')
  const searchRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(t)
  }, [query])

  const { data: tiersCfg } = useQuery({
    queryKey: ['hitch-tiers'],
    queryFn: () => hitchesApi.tiers(),
    staleTime: Infinity,
  })

  const { data: status } = useQuery({
    queryKey: ['hitch-catalog-status'],
    queryFn: () => hitchesApi.catalogStatus(),
  })

  const { data: results = [], isFetching: searching } = useQuery({
    queryKey: ['hitch-kit-search', debouncedQuery],
    queryFn: () => hitchesApi.searchKits(debouncedQuery),
    enabled: debouncedQuery.length >= 2 && !selectedKit,
  })

  const refreshMutation = useMutation({
    mutationFn: () => hitchesApi.refreshCatalog(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hitch-catalog-status'] })
      queryClient.invalidateQueries({ queryKey: ['hitch-kit-search'] })
    },
  })

  const createMutation = useMutation({
    mutationFn: (data) => hitchesApi.createQuote(data),
    onSuccess: (quote) => {
      queryClient.invalidateQueries({ queryKey: ['hitch-quotes'] })
      setSaved(quote)
      printQuote(quote)
    },
  })

  const pickKit = (kit) => {
    setSelectedKit(kit)
    setQuery(kit.title)
    setTier(kit.rackOnly ? 'RACK_ONLY' : null)
  }

  const resetForKit = () => {
    setSelectedKit(null)
    setQuery('')
    setTier(null)
    searchRef.current?.focus()
  }

  const resetAll = () => {
    resetForKit()
    setCustomerName(''); setCustomerPhone(''); setCustomerEmail(''); setNotes('')
    setSaved(null); setError('')
  }

  const tierFee = tier && tiersCfg ? tiersCfg.tiers[tier]?.fee : 0
  const kitPrice = selectedKit ? parseFloat(selectedKit.price) : 0
  const shipping = tiersCfg?.shipping ?? 40
  const taxRate = tiersCfg?.taxRate ?? 0.0635
  const subtotal = selectedKit && tier ? kitPrice + tierFee + shipping : 0
  const tax = Math.round(subtotal * taxRate * 100) / 100
  const total = Math.round((subtotal + tax) * 100) / 100

  const handleSave = () => {
    if (!selectedKit || !tier) return
    setError('')
    createMutation.mutate({
      hitchKitId: selectedKit.id,
      tier,
      customerName, customerPhone, customerEmail, notes,
    }, {
      onError: (e) => setError(e.message || 'Failed to save quote'),
    })
  }

  if (saved) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center px-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
          <CheckCircle2 size={28} className="text-emerald-400" />
        </div>
        <div>
          <p className="text-lg font-bold text-gray-100">Quote Saved</p>
          <p className="text-sm text-gray-500 mt-1">{saved.vehicleTitle} — {fmt$(saved.total)}</p>
        </div>
        <div className="flex gap-2.5 mt-2">
          <button onClick={() => printQuote(saved)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 font-medium transition-colors">
            <Printer size={14} /> Print Again
          </button>
          <button onClick={resetAll}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm text-white font-semibold transition-colors">
            New Quote
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Catalog status / refresh */}
      <div className="flex items-center justify-between mb-4 px-3 py-2 rounded-xl bg-gray-800/40 border border-gray-700/40">
        <span className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <Clock size={11} /> {status?.count ?? '…'} kits · synced {timeAgo(status?.lastSyncedAt)}
        </span>
        <button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={11} className={refreshMutation.isPending ? 'animate-spin' : ''} />
          {refreshMutation.isPending ? 'Refreshing…' : 'Refresh Catalog'}
        </button>
      </div>
      {refreshMutation.isError && <p className="text-xs text-red-400 mb-3">{refreshMutation.error.message}</p>}

      {/* Vehicle search */}
      {!selectedKit ? (
        <div className="relative mb-4">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search vehicle — e.g. BMW X5, Audi Q5…"
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-3 py-3 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          {debouncedQuery.length >= 2 && (
            <div className="mt-2 bg-gray-900 border border-gray-700/60 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
              {searching ? (
                <div className="flex justify-center py-6"><Spinner size="sm" /></div>
              ) : results.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-6">No matching kit found.</p>
              ) : (
                results.map(kit => (
                  <button
                    key={kit.id}
                    onClick={() => pickKit(kit)}
                    className="w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left hover:bg-gray-800/60 border-b border-gray-800/60 last:border-b-0 transition-colors"
                  >
                    <span className="text-sm text-gray-200 flex-1 min-w-0">
                      {kit.title}
                      {kit.rackOnly && <span className="ml-2 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 align-middle">Rack Only</span>}
                    </span>
                    <span className="text-sm font-bold text-gray-100 tabular-nums shrink-0">{fmt$(kit.price)}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between gap-2 bg-gray-800/50 border border-gray-700/40 rounded-xl px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-100 truncate">{selectedKit.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{fmt$(selectedKit.price)} kit cost{selectedKit.rackOnly && ' · Rack Only kit'}</p>
          </div>
          <button onClick={resetForKit} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 shrink-0">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Tier picker */}
      {selectedKit && tiersCfg && (
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Install Package</p>
          <div className="flex flex-col gap-2">
            {TIER_ORDER.filter(t => !selectedKit.rackOnly || t === 'RACK_ONLY').map(t => (
              <button
                key={t}
                onClick={() => setTier(t)}
                className={`flex items-center justify-between px-3.5 py-3 rounded-xl border text-left transition-all ${
                  tier === t
                    ? 'bg-blue-600/20 border-blue-500/50 text-blue-200'
                    : 'bg-gray-800/40 border-gray-700/40 text-gray-400 hover:border-gray-600'
                }`}
              >
                <span className="text-sm font-semibold">{tiersCfg.tiers[t].label}</span>
                <span className="text-sm font-bold tabular-nums">{fmt$(tiersCfg.tiers[t].fee)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Price breakdown */}
      {selectedKit && tier && (
        <div className="mb-4 bg-gray-800/50 border border-gray-700/40 rounded-xl p-4 space-y-1.5">
          <div className="flex justify-between text-sm"><span className="text-gray-500">Hitch Kit</span><span className="text-gray-200 tabular-nums">{fmt$(kitPrice)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-500">{tiersCfg.tiers[tier].label}</span><span className="text-gray-200 tabular-nums">{fmt$(tierFee)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-500">Shipping</span><span className="text-gray-200 tabular-nums">{fmt$(shipping)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-500">Tax ({(taxRate * 100).toFixed(2)}%)</span><span className="text-gray-200 tabular-nums">{fmt$(tax)}</span></div>
          <div className="flex justify-between text-base font-black pt-2 mt-1 border-t border-gray-700/50"><span className="text-gray-100">Total</span><span className="text-gray-100 tabular-nums">{fmt$(total)}</span></div>
        </div>
      )}

      {/* Customer info */}
      {selectedKit && tier && (
        <div className="mb-4 flex flex-col gap-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Customer (optional)</p>
          <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Name"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500" />
          <div className="grid grid-cols-2 gap-3">
            <input type="text" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="Phone"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500" />
            <input type="text" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="Email"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500" />
          </div>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500" />
        </div>
      )}

      {error && <p className="text-xs text-red-400 mb-2 text-center">{error}</p>}

      {selectedKit && tier && (
        <button
          onClick={handleSave}
          disabled={createMutation.isPending}
          className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
        >
          {createMutation.isPending ? 'Saving…' : 'Save & Print Quote'}
        </button>
      )}
    </div>
  )
}

function HistoryTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [deleteId, setDeleteId] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ['hitch-quotes', debounced],
    queryFn: () => hitchesApi.listQuotes(debounced),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => hitchesApi.removeQuote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hitch-quotes'] })
      setDeleteId(null)
    },
  })

  const tierLabel = { RACK_ONLY: 'Rack Only', RACK_AND_TOW: 'Rack and Tow', RACK_TOW_WIRING: 'Rack and Tow w/ Wiring' }

  return (
    <div>
      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by customer or vehicle…"
          className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : quotes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gray-800/60 flex items-center justify-center">
            <Link2 size={24} className="text-gray-600" />
          </div>
          <p className="text-gray-500 text-sm">No quotes yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {quotes.map(q => (
            <motion.div key={q.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="border rounded-xl p-3 bg-gray-800/40 border-gray-700/40">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-100 truncate">{q.customerName || 'No name'}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 truncate">{q.vehicleTitle}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    <span className="text-[11px] text-gray-600">{fmtDate(q.createdAt)}</span>
                    <span className="text-[11px] text-blue-400">{tierLabel[q.tier] || q.tier}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-base font-black text-gray-100 tabular-nums">{fmt$(q.total)}</span>
                  <button onClick={() => printQuote(q)} className="p-1.5 rounded-lg text-gray-600 hover:text-blue-400 hover:bg-blue-500/10 transition-colors">
                    <Printer size={13} />
                  </button>
                  {deleteId === q.id ? (
                    <div className="flex gap-1">
                      <button onClick={() => deleteMutation.mutate(q.id)}
                        className="px-2 py-1 text-[10px] font-bold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors">Del</button>
                      <button onClick={() => setDeleteId(null)} className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg transition-colors"><X size={12} /></button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteId(q.id)} className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function HitchQuotes() {
  const [activeTab, setActiveTab] = useState('new')

  return (
    <div className="px-4 py-5 pb-24 max-w-2xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <h1 className="text-xl font-black text-gray-100 tracking-tight">Hitch Quotes</h1>
        <p className="text-xs text-gray-600 mt-0.5">Stealth Hitches — authorized installer</p>
      </motion.div>

      <div className="flex gap-1 mb-5 bg-gray-800/50 border border-gray-700/40 rounded-xl p-1">
        {[['new', 'New Quote'], ['history', 'History']].map(([t, label]) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === t ? 'bg-blue-600 text-white shadow' : 'text-gray-500 hover:text-gray-300'
            }`}>
            {label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'new' ? <NewQuoteTab key="new" /> : <HistoryTab key="history" />}
      </AnimatePresence>
    </div>
  )
}
