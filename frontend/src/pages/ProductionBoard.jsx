import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Car, FileText, Check, ClipboardList, X, Clock, Truck,
  Search, Package, CheckCircle2, XCircle, User, Shield, AlertTriangle, Wrench,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { productionApi, rosApi } from '@/lib/api'
import { STAGES, STAGE_COLORS, formatTimeAgo } from '@/lib/utils'
import PartsBadge from '@/components/ui/PartsBadge'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import Textarea from '@/components/ui/Textarea'

// Card gradient based on total loss or parts status
function cardBg(partsStatus, isTotalLoss, totalLossReleased) {
  if (isTotalLoss && totalLossReleased) return 'from-emerald-950 to-gray-900'
  if (isTotalLoss) return 'from-purple-950 to-purple-900/60'
  if (partsStatus === 'MISSING') return 'from-red-950/60 to-gray-900'
  if (partsStatus === 'ACKNOWLEDGED') return 'from-amber-950/40 to-gray-900'
  if (partsStatus === 'ALL_HERE') return 'from-emerald-950/40 to-gray-900'
  return 'from-gray-800 to-gray-900'
}

// Insurance company → logo filename mapping
// Drop matching PNG/SVG files into /public/logos/ and they'll appear automatically
const INSURANCE_LOGOS = {
  'state farm':      'state-farm.jpg',
  'geico':           'geico.png',
  'progressive':     'progressive.webp',
  'allstate':        'allstate.png',
  'liberty mutual':  'liberty-mutual.png',
  'usaa':            'usaa.png',
  'farmers':         'farmers.jpg',
  'travelers':       'travelers.png',
  'nationwide':      'nationwide.jpg',
  'american family': 'american-family.png',
  'hartford':        'hartford.png',
  'aaa':             'aaa.png',
  'mapfre':          'mapfre.png',
  'arbella':         'arbella.png',
  'safety':          'safety.png',
  'commerce':        'commerce.png',
  'amica':           'amica.webp',
  'hanover':         'hanover.png',
}

function InsuranceLogo({ name }) {
  const [imgError, setImgError] = useState(false)
  if (!name) return null
  const key = name.toLowerCase().trim()
  const match = Object.keys(INSURANCE_LOGOS).find((k) => key.includes(k))

  // 2-letter abbreviation: first letters of first two words, or first 2 chars
  const words = name.trim().split(/\s+/)
  const abbr = words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()

  if (match && !imgError) {
    return (
      <img
        src={`/logos/${INSURANCE_LOGOS[match]}`}
        alt={name}
        className="h-12 w-32 object-contain rounded-xl bg-white/5 p-1.5"
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <div className="h-12 w-32 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600/50 flex items-center justify-center shrink-0 shadow-inner">
      <span className="text-xl font-black text-slate-200 tracking-tight leading-none">{abbr}</span>
    </div>
  )
}

function StageButton({ stage, active, onClick }) {
  const colorClass = active
    ? (STAGE_COLORS[stage] || 'bg-blue-600 text-white')
    : 'bg-gray-800/70 text-gray-500 hover:text-gray-200 hover:bg-gray-700/60'

  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150 border ${
        active ? `${colorClass} border-transparent ring-2 ring-white/20` : `${colorClass} border-gray-700/50`
      }`}
    >
      {stage}
    </button>
  )
}

// ── Supplement Quick-Note Bubbles ─────────────────────────────────────────────
const SUPP_PRESETS = ['PPD', 'Alignment', 'Scans', 'Calibrations', 'Scans & Calibrations', 'New Part']

function SupplementBubbles({ value, onChange }) {
  const [customInput, setCustomInput] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  // Parse current value into active tags
  const tags = value ? value.split(',').map(t => t.trim()).filter(Boolean) : []

  const toggleTag = (tag) => {
    if (tags.includes(tag)) {
      onChange(tags.filter(t => t !== tag).join(', '))
    } else {
      onChange([...tags, tag].join(', '))
    }
  }

  const addCustom = () => {
    const trimmed = customInput.trim()
    if (!trimmed) return
    if (!tags.includes(trimmed)) {
      onChange([...tags, trimmed].join(', '))
    }
    setCustomInput('')
    setShowCustom(false)
  }

  const removeTag = (tag) => {
    onChange(tags.filter(t => t !== tag).join(', '))
  }

  return (
    <div className="space-y-3">
      {/* Preset bubbles */}
      <div className="flex flex-wrap gap-2">
        {SUPP_PRESETS.map(preset => {
          const active = tags.includes(preset)
          return (
            <button
              key={preset}
              type="button"
              onClick={() => toggleTag(preset)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                active
                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-amber-500/40 hover:text-gray-200'
              }`}
            >
              {active && <span className="mr-1">✓</span>}
              {preset}
            </button>
          )
        })}
        {/* Custom bubble trigger */}
        <button
          type="button"
          onClick={() => setShowCustom(s => !s)}
          className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-gray-800 border-dashed border-gray-600 text-gray-500 hover:border-amber-500/40 hover:text-gray-200 transition-all"
        >
          + Custom
        </button>
      </div>

      {/* Custom input */}
      <AnimatePresence>
        {showCustom && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex gap-2">
              <input
                autoFocus
                type="text"
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCustom(); if (e.key === 'Escape') setShowCustom(false) }}
                placeholder="Type custom note..."
                className="flex-1 bg-gray-900/60 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500/50"
              />
              <button
                type="button"
                onClick={addCustom}
                className="px-3 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-sm font-semibold hover:bg-amber-500/30 transition-colors"
              >
                Add
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active tags display */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(tag => (
            <span
              key={tag}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs font-medium"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="text-amber-400/60 hover:text-amber-300 ml-0.5 transition-colors"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Technician Bubbles ────────────────────────────────────────────────────────
const TECHS = ['Stepan', 'Igor', 'Kiril', 'Kosta', 'Eugene', 'Andrii']

function TechBubbles({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TECHS.map((tech) => {
        const active = value === tech
        return (
          <button
            key={tech}
            type="button"
            onClick={() => onChange(active ? '' : tech)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              active
                ? 'bg-blue-500/20 border-blue-500/60 text-blue-300'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-blue-500/40 hover:text-gray-200'
            }`}
          >
            {active && <span className="mr-1">✓</span>}
            {tech}
          </button>
        )
      })}
    </div>
  )
}

// ── Parts Sheet ──────────────────────────────────────────────────────────────
function PartsSheet({ open, onClose, parts, roNumber }) {
  const received = parts.filter((p) => p.isReceived)
  const pending  = parts.filter((p) => !p.isReceived)

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 35 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-700/60 rounded-t-2xl max-h-[75vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800/60 shrink-0">
              <div className="flex items-center gap-2">
                <Package size={17} className="text-blue-400" />
                <h2 className="text-base font-bold text-gray-100">Parts — RO #{roNumber}</h2>
              </div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Pending */}
              {pending.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <XCircle size={13} /> Missing / Not Received ({pending.length})
                  </p>
                  <div className="space-y-1.5">
                    {pending.map((p) => (
                      <div key={p.id} className="bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">
                        <p className="text-sm text-gray-200">{p.description || '(no description)'}</p>
                        {p.partNumber && <p className="text-xs text-gray-500 mt-0.5">#{p.partNumber}</p>}
                        {p.qty > 1 && <p className="text-xs text-gray-500">Qty: {p.qty}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Received */}
              {received.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <CheckCircle2 size={13} /> Received ({received.length})
                  </p>
                  <div className="space-y-1.5">
                    {received.map((p) => (
                      <div key={p.id} className="bg-emerald-950/30 border border-emerald-900/40 rounded-lg px-3 py-2">
                        <p className="text-sm text-gray-200">{p.description || '(no description)'}</p>
                        {p.partNumber && <p className="text-xs text-gray-500 mt-0.5">#{p.partNumber}</p>}
                        {p.qty > 1 && <p className="text-xs text-gray-500">Qty: {p.qty}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {parts.length === 0 && (
                <p className="text-center text-gray-500 text-sm py-8">No parts on this RO</p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Daily Log Sheet ──────────────────────────────────────────────────────────
function DailyLogSheet({ open, onClose }) {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['production-activity'],
    queryFn: () => productionApi.activity(),
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  })

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 35 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-700/60 rounded-t-2xl max-h-[80vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800/60 shrink-0">
              <div className="flex items-center gap-2">
                <ClipboardList size={18} className="text-blue-400" />
                <h2 className="text-base font-bold text-gray-100">Today's Board Updates</h2>
              </div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1">
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isLoading && (
                <div className="flex justify-center py-8">
                  <Spinner size="lg" />
                </div>
              )}
              {!isLoading && (!logs || logs.length === 0) && (
                <div className="text-center py-10 text-gray-500">
                  <ClipboardList size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No board updates today</p>
                </div>
              )}
              {logs && logs.map((log) => (
                <div
                  key={log.id}
                  className="bg-gray-800/60 border border-gray-700/40 rounded-xl p-3.5"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-sm font-bold text-gray-100 font-mono">
                      {log.ro?.roNumber}
                    </span>
                    <span className="text-xs text-gray-500 flex items-center gap-1 shrink-0">
                      <Clock size={11} />
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {log.ro && (
                    <p className="text-xs text-gray-500 mb-1.5">
                      {[log.ro.vehicleYear, log.ro.vehicleMake, log.ro.vehicleModel].filter(Boolean).join(' ')}
                    </p>
                  )}
                  <p className="text-sm text-gray-300">{log.message}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ProductionBoard() {
  const queryClient = useQueryClient()
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(0) // -1 prev, 1 next
  const [localEdits, setLocalEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [confirmDeliver, setConfirmDeliver] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [partsOpen, setPartsOpen] = useState(false)
  const searchRef = useRef(null)
  const saveTimeout = useRef(null)
  const touchStart = useRef(null) // { x, y }

  const { data: ros, isLoading } = useQuery({
    queryKey: ['production'],
    queryFn: productionApi.list,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })

  const mutation = useMutation({
    mutationFn: ({ roId, data }) => productionApi.save(roId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production'] })
      setSaving(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (err) => {
      setSaving(false)
      toast.error(err.message || 'Failed to save')
    },
  })

  const deliverMutation = useMutation({
    mutationFn: (id) => rosApi.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production'] })
      setConfirmDeliver(false)
      toast.success('RO marked as delivered')
      // Stay at same index (next RO slides in), or go back if it was the last
      setIndex((prev) => Math.max(0, Math.min(prev, activeROs.length - 2)))
    },
    onError: (err) => {
      toast.error(err.message || 'Failed to mark delivered')
    },
  })

  const activeROs = (ros?.filter((r) => !r.isArchived) || [])
    .sort((a, b) => (parseInt(a.roNumber, 10) || 0) - (parseInt(b.roNumber, 10) || 0))
  const currentRO = activeROs[index]

  // Search results
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return activeROs.filter((r) =>
      r.roNumber?.toLowerCase().includes(q) ||
      r.vehicleMake?.toLowerCase().includes(q) ||
      r.vehicleModel?.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [searchQuery, activeROs])

  const jumpTo = (ro) => {
    const idx = activeROs.findIndex((r) => r.id === ro.id)
    if (idx !== -1) saveAndNavigate(idx)
    setSearchOpen(false)
    setSearchQuery('')
  }

  // Close search on outside click
  useEffect(() => {
    if (!searchOpen) return
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false)
        setSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [searchOpen])

  // Merge local edits over server data
  const getState = (ro) => {
    const local = localEdits[ro?.id] || {}
    return {
      productionStage: local.productionStage ?? ro?.productionStage ?? 'Unassigned',
      productionStatusNote: local.productionStatusNote ?? ro?.productionStatusNote ?? '',
      productionFinalSupplement: local.productionFinalSupplement ?? ro?.productionFinalSupplement ?? false,
      productionSupplementNote: local.productionSupplementNote ?? ro?.productionSupplementNote ?? '',
      isTotalLoss: local.isTotalLoss ?? ro?.isTotalLoss ?? false,
      totalLossReleased: local.totalLossReleased ?? ro?.totalLossReleased ?? false,
      assignedTech: local.assignedTech ?? ro?.assignedTech ?? '',
    }
  }

  // Debounced auto-save
  const scheduleSave = useCallback((roId, data) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    setSaving(true)
    setSaved(false)
    saveTimeout.current = setTimeout(() => {
      mutation.mutate({ roId, data })
    }, 1200)
  }, [mutation])

  const updateField = (field, value) => {
    if (!currentRO) return
    const roId = currentRO.id
    const merged = { ...getState(currentRO), ...localEdits[currentRO.id], [field]: value }
    setLocalEdits((prev) => ({ ...prev, [roId]: merged }))
    scheduleSave(roId, merged)
  }

  // Flush pending save before navigating
  const saveAndNavigate = (newIndex) => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current)
      if (currentRO) {
        const state = { ...getState(currentRO), ...localEdits[currentRO.id] }
        mutation.mutate({ roId: currentRO.id, data: state })
      }
    }
    setDirection(newIndex > index ? 1 : -1)
    setIndex(newIndex)
  }

  const goPrev = () => { if (index > 0) saveAndNavigate(index - 1) }
  const goNext = () => { if (index < activeROs.length - 1) saveAndNavigate(index + 1) }

  // Keyboard arrow keys — stable ref so listener is added once (not torn down on every keystroke)
  const navRef = useRef({})
  navRef.current = { goPrev, goNext, logOpen, partsOpen, searchOpen }
  useEffect(() => {
    const onKey = (e) => {
      if (navRef.current.logOpen || navRef.current.partsOpen || navRef.current.searchOpen) return
      if (e.key === 'ArrowLeft') navRef.current.goPrev()
      if (e.key === 'ArrowRight') navRef.current.goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Touch swipe — horizontal only (won't conflict with vertical scroll)
  const handleTouchStart = (e) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const handleTouchEnd = (e) => {
    if (!touchStart.current) return
    const dx = e.changedTouches[0].clientX - touchStart.current.x
    const dy = e.changedTouches[0].clientY - touchStart.current.y
    touchStart.current = null
    // Only trigger if horizontal movement is dominant and > 55px
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) goNext()
      else goPrev()
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  if (activeROs.length === 0) {
    return (
      <div className="px-4 py-8">
        <EmptyState
          icon={Car}
          title="No active ROs"
          description="All repair orders are archived or none exist yet"
        />
      </div>
    )
  }

  const ro = currentRO
  const state = getState(ro)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar: counter + search + save status + log button */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-b border-gray-800/60 shrink-0 sm:px-6 gap-2">
        <span className="text-sm font-medium text-gray-400 shrink-0">
          {index + 1} <span className="text-gray-600">of</span> {activeROs.length}
        </span>

        {/* Search */}
        <div ref={searchRef} className="relative flex-1 max-w-[200px]">
          {searchOpen ? (
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (setSearchOpen(false), setSearchQuery(''))}
              placeholder="RO #, make, model…"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2.5 py-1 text-xs text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500"
            />
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded-lg bg-gray-800/60 border border-gray-700/50 transition-colors"
            >
              <Search size={13} />
              Jump to RO
            </button>
          )}

          {/* Dropdown results */}
          <AnimatePresence>
            {searchOpen && searchResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden"
              >
                {searchResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => jumpTo(r)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-700 transition-colors border-b border-gray-700/50 last:border-0"
                  >
                    <span className="text-sm font-bold text-gray-100 font-mono">{r.roNumber}</span>
                    <span className="text-xs text-gray-400 ml-2">
                      {[r.vehicleYear, r.vehicleMake, r.vehicleModel].filter(Boolean).join(' ')}
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            {saving && <><Spinner size="sm" /><span>Saving…</span></>}
            {!saving && saved && <><Check size={13} className="text-emerald-400" /><span className="text-emerald-400">Saved</span></>}
          </div>
          <button
            onClick={() => setLogOpen(true)}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded-lg bg-blue-950/40 border border-blue-900/50 transition-colors"
          >
            <ClipboardList size={13} />
            Log
          </button>
        </div>
      </div>

      {/* Swipeable card area */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4 sm:px-6"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Centered container — constrains width on large screens */}
        <div className="mx-auto w-full max-w-2xl">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={ro.id}
            custom={direction}
            initial={{ opacity: 0, x: direction * 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -direction * 60 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* RO card */}
            <div className={`bg-gradient-to-b ${cardBg(ro.partsStatus, state.isTotalLoss, state.totalLossReleased)} border ${
              state.isTotalLoss && state.totalLossReleased ? 'border-emerald-600/60' :
              state.isTotalLoss ? 'border-purple-500/60' : 'border-gray-700/50'
            } rounded-2xl p-5 mb-4 shadow-lg`}>
              <div className="flex items-start justify-between gap-3 mb-4">
                {/* Left — all RO detail */}
                <div className="flex-1 min-w-0">
                  {/* RO number + badges */}
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h2 className="text-2xl font-black text-white font-mono tracking-tight">{ro.roNumber}</h2>
                    <PartsBadge status={ro.partsStatus} />
                    {state.isTotalLoss && (
                      <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/50 text-purple-300">
                        <AlertTriangle size={11} /> Total Loss
                      </span>
                    )}
                  </div>

                  {/* Vehicle — prominent */}
                  {[ro.vehicleYear, ro.vehicleMake, ro.vehicleModel].some(Boolean) && (
                    <p className="text-base font-bold text-gray-100 leading-snug mb-0.5">
                      {[ro.vehicleYear, ro.vehicleMake, ro.vehicleModel].filter(Boolean).join(' ')}
                      {ro.vehicleColor && <span className="text-gray-400 font-normal"> · {ro.vehicleColor}</span>}
                    </p>
                  )}

                  {/* VIN */}
                  {ro.vin && (
                    <p className="text-xs text-gray-500 font-mono mb-1">{ro.vin}</p>
                  )}

                  {/* Customer name — stands out */}
                  {ro.ownerName && (
                    <p className="text-sm font-semibold text-gray-200 flex items-center gap-1.5 mt-1">
                      <User size={12} className="text-blue-400 shrink-0" />
                      {ro.ownerName}
                    </p>
                  )}

                  {/* Vendor + tech + timestamp */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5">
                    {ro.vendor?.name && (
                      <span className="text-xs text-gray-500">{ro.vendor.name}</span>
                    )}
                    {state.assignedTech && (
                      <span className="text-xs text-blue-400 flex items-center gap-1">
                        <Wrench size={10} /> {state.assignedTech}
                      </span>
                    )}
                    {ro.productionUpdatedAt && (
                      <span className="text-xs text-gray-600 flex items-center gap-1">
                        <Clock size={10} />
                        {formatTimeAgo(ro.productionUpdatedAt)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right — logo + final supp badge */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {/* Insurance logo */}
                  {ro.insuranceCompany && (
                    <InsuranceLogo name={ro.insuranceCompany} />
                  )}
                  {state.productionFinalSupplement && (
                    <div className="bg-amber-500/15 border border-amber-500/30 rounded-xl px-2.5 py-1.5">
                      <p className="text-xs font-semibold text-amber-400 flex items-center gap-1">
                        <FileText size={12} /> Final Supp.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Customer / Insurance quick info */}
              {(ro.ownerName || ro.ownerPhone || ro.insuranceCompany || ro.claimNumber || ro.adjusterName || ro.adjusterPhone || ro.deductible) && (
                <div className="mt-3 pt-3 border-t border-gray-700/40 space-y-1.5">
                  {(ro.ownerName || ro.ownerPhone) && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <User size={11} className="text-blue-400 shrink-0" />
                      {ro.ownerName && <span className="text-gray-200 font-medium">{ro.ownerName}</span>}
                      {ro.ownerPhone && (
                        <a href={`tel:${ro.ownerPhone}`} className="text-blue-400 hover:text-blue-300 transition-colors">
                          {ro.ownerPhone}
                        </a>
                      )}
                      {ro.ownerPhone2 && (
                        <a href={`tel:${ro.ownerPhone2}`} className="text-blue-400 hover:text-blue-300 transition-colors">
                          · {ro.ownerPhone2}
                        </a>
                      )}
                    </div>
                  )}
                  {(ro.insuranceCompany || ro.claimNumber) && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <Shield size={11} className="text-emerald-400 shrink-0" />
                      {ro.insuranceCompany && <span className="text-gray-200 font-medium">{ro.insuranceCompany}</span>}
                      {ro.claimNumber && <span className="text-gray-500 font-mono">#{ro.claimNumber}</span>}
                    </div>
                  )}
                  {(ro.adjusterName || ro.adjusterPhone) && (
                    <div className="flex items-center gap-1.5 text-xs pl-4">
                      {ro.adjusterName && <span className="text-gray-400">Adj: <span className="text-gray-300">{ro.adjusterName}</span></span>}
                      {ro.adjusterPhone && (
                        <a href={`tel:${ro.adjusterPhone}`} className="text-blue-400 hover:text-blue-300 transition-colors">
                          {ro.adjusterPhone}
                        </a>
                      )}
                    </div>
                  )}
                  {ro.deductible != null && (
                    <div className="flex items-center gap-1.5 text-xs pl-4">
                      <span className="text-gray-500">Deductible: <span className="text-gray-300">${Number(ro.deductible).toFixed(2)}</span></span>
                    </div>
                  )}
                </div>
              )}

              {/* Parts summary — tap to see full list */}
              {ro.parts && ro.parts.length > 0 && (
                <button
                  onClick={() => setPartsOpen(true)}
                  className="w-full bg-gray-900/60 rounded-xl p-3 text-xs text-left hover:bg-gray-900/80 transition-colors active:bg-gray-900"
                >
                  <div className="flex gap-6 text-center">
                    <div>
                      <p className="text-gray-500">Total</p>
                      <p className="text-gray-200 font-bold text-base">{ro.parts.length}</p>
                    </div>
                    <div>
                      <p className="text-emerald-500">Received</p>
                      <p className="text-emerald-400 font-bold text-base">
                        {ro.parts.filter((p) => p.isReceived).length}
                      </p>
                    </div>
                    <div>
                      <p className="text-red-500">Pending</p>
                      <p className="text-red-400 font-bold text-base">
                        {ro.parts.filter((p) => !p.isReceived).length}
                      </p>
                    </div>
                    <div className="ml-auto flex items-center text-gray-600 text-xs gap-1">
                      <Package size={11} />
                      <span>View</span>
                    </div>
                  </div>
                </button>
              )}
            </div>

            <AnimatePresence>
              {!state.isTotalLoss && (
                <motion.div
                  key="normal-controls"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  {/* Stage selector */}
                  <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-4 mb-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Stage</p>
                    <div className="flex flex-wrap gap-2">
                      {STAGES.map((s) => (
                        <StageButton
                          key={s}
                          stage={s}
                          active={state.productionStage === s}
                          onClick={() => updateField('productionStage', s)}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Status note */}
                  <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-4 mb-3">
                    <Textarea
                      label="Status Note"
                      value={state.productionStatusNote}
                      onChange={(e) => updateField('productionStatusNote', e.target.value)}
                      rows={3}
                      placeholder="Add a note about current status..."
                      className="bg-gray-900/60"
                    />
                  </div>

                  {/* Technician assignment */}
                  <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-4 mb-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Wrench size={12} /> Assigned Tech
                    </p>
                    <TechBubbles
                      value={state.assignedTech}
                      onChange={(val) => updateField('assignedTech', val)}
                    />
                  </div>

                  {/* Final supplement toggle */}
                  <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-4 mb-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <div
                        onClick={() => updateField('productionFinalSupplement', !state.productionFinalSupplement)}
                        className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex items-center ${
                          state.productionFinalSupplement ? 'bg-amber-500' : 'bg-gray-700'
                        }`}
                      >
                        <motion.div
                          animate={{ x: state.productionFinalSupplement ? 24 : 2 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          className="w-5 h-5 bg-white rounded-full shadow-md absolute"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-200">Final Supplement</p>
                        <p className="text-xs text-gray-500">Toggle if this RO has a final supplement pending</p>
                      </div>
                    </label>

                    <AnimatePresence>
                      {state.productionFinalSupplement && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-3 overflow-hidden"
                        >
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Quick Notes</p>
                          <SupplementBubbles
                            value={state.productionSupplementNote}
                            onChange={(val) => updateField('productionSupplementNote', val)}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Total Loss toggle — always visible */}
            <div className={`border rounded-2xl p-4 mb-3 transition-colors duration-300 ${
              state.isTotalLoss
                ? 'bg-purple-950/60 border-purple-500/60'
                : 'bg-gray-800/60 border-gray-700/50'
            }`}>
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => updateField('isTotalLoss', !state.isTotalLoss)}
                  className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex items-center shrink-0 ${
                    state.isTotalLoss ? 'bg-purple-500' : 'bg-gray-700'
                  }`}
                >
                  <motion.div
                    animate={{ x: state.isTotalLoss ? 24 : 2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className="w-5 h-5 bg-white rounded-full shadow-md absolute"
                  />
                </div>
                <div>
                  <p className={`text-sm font-semibold flex items-center gap-1.5 ${state.isTotalLoss ? 'text-purple-300' : 'text-gray-200'}`}>
                    <AlertTriangle size={14} />
                    Total Loss
                  </p>
                  <p className="text-xs text-gray-500">Flags this vehicle as a total loss</p>
                </div>
              </label>

              <AnimatePresence>
                {state.isTotalLoss && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden mt-4"
                  >
                    <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">Released to Insurance?</p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => updateField('totalLossReleased', true)}
                        className={`flex-1 py-5 rounded-xl font-black text-2xl tracking-tight transition-all duration-200 border-2 ${
                          state.totalLossReleased
                            ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-900/40'
                            : 'bg-gray-800/60 border-gray-600/50 text-gray-400 hover:border-emerald-500/50 hover:text-emerald-400'
                        }`}
                      >
                        YES
                      </button>
                      <button
                        onClick={() => updateField('totalLossReleased', false)}
                        className={`flex-1 py-5 rounded-xl font-black text-2xl tracking-tight transition-all duration-200 border-2 ${
                          !state.totalLossReleased
                            ? 'bg-red-600 border-red-500 text-white shadow-lg shadow-red-900/40'
                            : 'bg-gray-800/60 border-gray-600/50 text-gray-400 hover:border-red-500/50 hover:text-red-400'
                        }`}
                      >
                        NO
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </AnimatePresence>
        </div> {/* end max-w-2xl container */}
      </div>

      {/* Prev / Next / Delivered navigation */}
      <div className="shrink-0 bg-gray-950 border-t border-gray-800/60 px-4 py-3 pb-safe sm:px-6">
        <div className="mx-auto w-full max-w-2xl space-y-2">
          {/* Prev + Next */}
          <div className="flex gap-3">
            <button
              onClick={goPrev}
              disabled={index === 0}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 font-semibold text-sm disabled:opacity-30 disabled:pointer-events-none active:bg-gray-700 transition-colors"
            >
              <ChevronLeft size={20} />
              Prev
            </button>
            <button
              onClick={goNext}
              disabled={index >= activeROs.length - 1}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 border border-blue-500 text-white font-semibold text-sm disabled:opacity-30 disabled:pointer-events-none active:bg-blue-700 transition-colors"
            >
              Next
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Delivered button / confirm */}
          <AnimatePresence mode="wait">
            {!confirmDeliver ? (
              <motion.button
                key="deliver-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setConfirmDeliver(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600/20 border border-emerald-600/40 text-emerald-400 font-semibold text-sm hover:bg-emerald-600/30 active:bg-emerald-600/40 transition-colors"
              >
                <Truck size={16} />
                Mark as Delivered
              </motion.button>
            ) : (
              <motion.div
                key="deliver-confirm"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="flex gap-2 items-center bg-emerald-950/60 border border-emerald-700/50 rounded-xl px-3 py-2"
              >
                <p className="flex-1 text-xs text-emerald-300 font-medium">
                  Deliver RO #{ro.roNumber}? This removes it from the board.
                </p>
                <button
                  onClick={() => setConfirmDeliver(false)}
                  className="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-xs font-semibold hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deliverMutation.mutate(ro.id)}
                  disabled={deliverMutation.isPending}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 disabled:opacity-50 transition-colors flex items-center gap-1"
                >
                  {deliverMutation.isPending ? <Spinner size="sm" /> : <Truck size={12} />}
                  Confirm
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Daily log sheet */}
      <DailyLogSheet open={logOpen} onClose={() => setLogOpen(false)} />

      {/* Parts sheet */}
      <PartsSheet open={partsOpen} onClose={() => setPartsOpen(false)} parts={ro?.parts || []} roNumber={ro?.roNumber} />
    </div>
  )
}
