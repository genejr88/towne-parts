// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION BOARD V2 — Stage-first redesign (mock for comparison)
//
// Design goals:
// 1. The current stage is the hero. One-tap "advance" is the primary action.
// 2. Notes are the body — a clean dated feed, not a section card.
// 3. Active flags are loud. Inactive flags hide behind a "+ Flag" pill.
// 4. Tech + insurance ride as small chips, not full sections.
// 5. "⋯ More" sheet hides rarely-used controls (Total Loss, HBM, Pre-Storage,
//    Final Supplement, full edit).
//
// Shares the same ['production'] TanStack query as the legacy board, so
// edits sync live between the two views.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Check, ArrowRight, Plus, X, MoreHorizontal,
  Car, Wrench, AlertTriangle, Warehouse, FileText, Shield, User,
  ExternalLink, Pencil, ListTodo, Activity, Sparkles, Home, Bell, Clock,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { productionApi, techniciansApi, useStages } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { STAGES, STAGE_COLORS, formatTimeAgo } from '@/lib/utils'
import Spinner from '@/components/ui/Spinner'
import Textarea from '@/components/ui/Textarea'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseStatusNotes(text) {
  if (!text || !text.trim()) return []
  const headerRe = /^\[([^\]\n]+)\]\s*$/gm
  const matches = [...text.matchAll(headerRe)]
  if (matches.length === 0) return [{ header: null, body: text.trim() }]
  const entries = []
  if (matches[0].index > 0) {
    const prefix = text.slice(0, matches[0].index).trim()
    if (prefix) entries.push({ header: null, body: prefix })
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length
    const body = text.slice(start, end).trim()
    entries.push({ header: matches[i][1].trim(), body })
  }
  return entries.reverse()
}

function buildNoteHeader(username) {
  const now = new Date()
  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const who = (username || '').trim()
  return who ? `[${date} ${time} — ${who}]` : `[${date} ${time}]`
}

function mergeState(ro, local) {
  const l = local || {}
  return {
    productionStage:           l.productionStage           ?? ro?.productionStage           ?? 'Unassigned',
    productionStatusNote:      l.productionStatusNote      ?? ro?.productionStatusNote      ?? '',
    productionFinalSupplement: l.productionFinalSupplement ?? ro?.productionFinalSupplement ?? false,
    isHBM:                     l.isHBM                     ?? ro?.isHBM                     ?? false,
    isTotalLoss:               l.isTotalLoss               ?? ro?.isTotalLoss               ?? false,
    totalLossReleased:         l.totalLossReleased         ?? ro?.totalLossReleased         ?? false,
    prestorageActive:          l.prestorageActive          ?? ro?.prestorageActive          ?? false,
    assignedTech:              l.assignedTech              ?? ro?.assignedTech              ?? '',
  }
}

function effectivePartsStatus(ro) {
  if (!ro?.parts || ro.parts.length === 0) return ro?.partsStatus || 'MISSING'
  if (ro.parts.every((p) => p.isReceived)) return 'ALL_HERE'
  if (ro.partsStatus === 'ACKNOWLEDGED') return 'ACKNOWLEDGED'
  return 'MISSING'
}

// ─── Tiny inline components ──────────────────────────────────────────────────
function PartsDot({ status }) {
  const cfg = {
    MISSING:      { c: 'bg-red-400 shadow-red-400/60',         label: 'Parts Missing' },
    ACKNOWLEDGED: { c: 'bg-amber-400 shadow-amber-400/60',     label: 'Parts Acknowledged' },
    ALL_HERE:     { c: 'bg-emerald-400 shadow-emerald-400/60', label: 'Parts All In' },
  }[status]
  if (!cfg) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] text-gray-300" title={cfg.label}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.c} shadow-md`} />
      {cfg.label}
    </span>
  )
}

function FlagChip({ tone, icon: Icon, label, onRemove }) {
  const tones = {
    blue:    'from-blue-500/30    to-sky-500/30      border-blue-400/60     text-blue-100',
    pink:    'from-pink-500/35    to-fuchsia-500/35  border-pink-400/70     text-pink-100',
    purple:  'from-purple-500/35  to-fuchsia-500/35  border-purple-400/70   text-purple-100',
    emerald: 'from-emerald-500/35 to-teal-500/35     border-emerald-400/70  text-emerald-100',
    orange:  'from-orange-500/35  to-amber-500/35    border-orange-400/70   text-orange-100',
    amber:   'from-amber-500/30   to-yellow-500/30   border-amber-400/60    text-amber-100',
  }[tone] || 'from-gray-500/30 to-gray-600/30 border-gray-500/50 text-gray-200'
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-gradient-to-r border shadow-md ring-1 ring-white/5 ${tones}`}>
      <Icon size={11} /> {label}
      {onRemove && (
        <button onClick={onRemove} className="opacity-60 hover:opacity-100 ml-0.5">
          <X size={11} />
        </button>
      )}
    </span>
  )
}

// ─── Tech Picker (compact) ───────────────────────────────────────────────────
function TechPicker({ value, onChange, open, onClose }) {
  const { data: techs } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => techniciansApi.list(),
    staleTime: 60_000,
  })
  if (!open) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      className="absolute right-0 top-full mt-2 z-30 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-2 min-w-[180px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500 px-2 pt-1 pb-1.5">
        Assign Tech
      </div>
      <button
        onClick={() => { onChange(''); onClose() }}
        className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg ${!value ? 'bg-gray-800 text-gray-200' : 'text-gray-400 hover:bg-gray-800'}`}
      >
        Unassigned
      </button>
      {(techs || []).map((t) => (
        <button
          key={t.id}
          onClick={() => { onChange(t.name); onClose() }}
          className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg ${value === t.name ? 'bg-blue-500/20 text-blue-300' : 'text-gray-300 hover:bg-gray-800'}`}
        >
          {value === t.name && <span className="mr-1">✓</span>}
          {t.name}
        </button>
      ))}
    </motion.div>
  )
}

// ─── Stage Picker Sheet ──────────────────────────────────────────────────────
function StagePickerSheet({ open, onClose, value, onChange }) {
  const stages = useStages()
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-700/60 rounded-t-2xl max-h-[80vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800/60">
              <h2 className="text-base font-bold text-gray-100">Change Stage</h2>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-2">
              {stages.map((s) => {
                const active = value === s
                const cls = STAGE_COLORS[s] || 'bg-blue-600 text-white'
                return (
                  <button
                    key={s}
                    onClick={() => { onChange(s); onClose() }}
                    className={`px-4 py-3 rounded-xl text-sm font-bold text-left transition-all border ${
                      active
                        ? `${cls} border-white/30 ring-2 ring-white/20`
                        : 'bg-gray-800/60 border-gray-700/50 text-gray-300 hover:border-blue-500/40'
                    }`}
                  >
                    {active && <span className="mr-1">✓</span>}
                    {s}
                  </button>
                )
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── Add Flag popover ────────────────────────────────────────────────────────
function AddFlagPopover({ open, onClose, state, onToggle }) {
  if (!open) return null
  const items = [
    { key: 'isHBM',                     label: 'HBM (sister shop)',  on: state.isHBM,                     icon: Wrench,         tone: 'text-pink-300'   },
    { key: 'isTotalLoss',               label: 'Total Loss',         on: state.isTotalLoss,               icon: AlertTriangle,  tone: 'text-purple-300' },
    { key: 'prestorageActive',          label: 'Pre-Storage',        on: state.prestorageActive,          icon: Warehouse,      tone: 'text-orange-300' },
    { key: 'productionFinalSupplement', label: 'Final Supplement',   on: state.productionFinalSupplement, icon: FileText,       tone: 'text-amber-300'  },
  ]
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="absolute z-30 top-full mt-2 right-0 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-2 min-w-[220px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500 px-2 pt-1 pb-1.5">
        Toggle Flags
      </div>
      {items.map(({ key, label, on, icon: Icon, tone }) => (
        <button
          key={key}
          onClick={() => onToggle(key)}
          className={`w-full flex items-center gap-2.5 text-left text-xs px-2.5 py-2 rounded-lg ${
            on ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:bg-gray-800'
          }`}
        >
          <Icon size={13} className={on ? tone : 'text-gray-600'} />
          <span className="flex-1">{label}</span>
          {on && <Check size={13} className="text-emerald-400" />}
        </button>
      ))}
    </motion.div>
  )
}

// ─── "More" sheet ────────────────────────────────────────────────────────────
function MoreSheet({ open, onClose, ro, state, updateField }) {
  const navigate = useNavigate()
  if (!ro) return null
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-700/60 rounded-t-2xl max-h-[80vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800/60">
              <h2 className="text-base font-bold text-gray-100">More — RO #{ro.roNumber}</h2>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {/* Flag toggles */}
              <ToggleRow label="HBM (sister shop)" icon={Wrench} tone="pink" on={state.isHBM} onClick={() => updateField('isHBM', !state.isHBM)} />
              <ToggleRow label="Total Loss" icon={AlertTriangle} tone="purple" on={state.isTotalLoss} onClick={() => updateField('isTotalLoss', !state.isTotalLoss)} />
              {state.isTotalLoss && (
                <div className="ml-12 -mt-1 pl-3 border-l-2 border-purple-500/40 py-2 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-purple-400">Released to Insurance?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateField('totalLossReleased', true)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold ${state.totalLossReleased ? 'bg-emerald-500 text-white' : 'bg-gray-800 text-gray-400'}`}
                    >YES</button>
                    <button
                      onClick={() => updateField('totalLossReleased', false)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold ${!state.totalLossReleased ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400'}`}
                    >NO</button>
                  </div>
                </div>
              )}
              <ToggleRow label="Pre-Storage" icon={Warehouse} tone="orange" on={state.prestorageActive} onClick={() => updateField('prestorageActive', !state.prestorageActive)} />
              <ToggleRow label="Final Supplement" icon={FileText} tone="amber" on={state.productionFinalSupplement} onClick={() => updateField('productionFinalSupplement', !state.productionFinalSupplement)} />

              <div className="pt-3 mt-3 border-t border-gray-800 space-y-2">
                <button
                  onClick={() => { onClose(); navigate(`/ros/${ro.id}`) }}
                  className="w-full flex items-center justify-between gap-2 bg-gray-800/60 border border-gray-700/50 hover:border-blue-500/50 rounded-xl px-3.5 py-3 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <ExternalLink size={14} className="text-blue-400" />
                    <span className="text-sm font-semibold text-gray-100">Open full RO detail</span>
                  </div>
                  <ChevronRight size={16} className="text-gray-500" />
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function ToggleRow({ label, icon: Icon, tone, on, onClick }) {
  const tones = {
    pink:    on ? 'bg-pink-950/50    border-pink-500/60     text-pink-200'    : '',
    purple:  on ? 'bg-purple-950/50  border-purple-500/60   text-purple-200'  : '',
    orange:  on ? 'bg-orange-950/50  border-orange-500/60   text-orange-200'  : '',
    amber:   on ? 'bg-amber-950/40   border-amber-500/50    text-amber-200'   : '',
  }
  const switchColors = { pink: 'bg-pink-500', purple: 'bg-purple-500', orange: 'bg-orange-500', amber: 'bg-amber-500' }
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all ${
        on ? tones[tone] : 'bg-gray-800/40 border-gray-700/40 text-gray-300 hover:border-gray-600'
      }`}
    >
      <div className={`w-11 h-6 rounded-full relative flex items-center shrink-0 ${on ? switchColors[tone] : 'bg-gray-700'}`}>
        <motion.div
          animate={{ x: on ? 22 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="w-5 h-5 bg-white rounded-full shadow"
        />
      </div>
      <Icon size={15} className={on ? '' : 'text-gray-600'} />
      <span className="text-sm font-semibold text-left flex-1">{label}</span>
    </button>
  )
}

// ─── HBM Activity Feed Sheet ─────────────────────────────────────────────────
function HbmFeedSheet({ open, onClose, onSeen }) {
  const navigate = useNavigate()
  const { data: updates, isLoading } = useQuery({
    queryKey: ['hbm-feed'],
    queryFn: () => productionApi.hbmFeed(30),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  })

  useEffect(() => {
    if (open && updates?.length) {
      const newest = updates[0]?.createdAt
      if (newest) onSeen?.(newest)
    }
  }, [open, updates, onSeen])

  const grouped = useMemo(() => {
    if (!updates?.length) return []
    const map = {}
    for (const u of updates) {
      const k = new Date(u.createdAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
      if (!map[k]) map[k] = []
      map[k].push(u)
    }
    return Object.entries(map)
  }, [updates])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-pink-700/40 rounded-t-2xl max-h-[80vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800/60">
              <div className="flex items-center gap-2">
                <Wrench size={16} className="text-pink-400" />
                <h2 className="text-base font-bold text-gray-100">HBM Board Activity</h2>
              </div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {isLoading && <div className="flex justify-center py-10"><Spinner size="lg" /></div>}
              {!isLoading && grouped.length === 0 && (
                <div className="text-center py-10 text-gray-500">
                  <Wrench size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No HBM activity yet</p>
                </div>
              )}
              {grouped.map(([date, entries]) => (
                <div key={date}>
                  <p className="text-xs font-bold text-pink-400/80 uppercase tracking-wider mb-2">{date}</p>
                  <div className="space-y-2">
                    {entries.map((u) => {
                      const veh = [u.ro?.vehicleYear, u.ro?.vehicleMake, u.ro?.vehicleModel].filter(Boolean).join(' ')
                      const fields = []
                      if (u.stage)        fields.push({ k: 'Stage', v: u.stage })
                      if (u.statusNote)   fields.push({ k: 'Note', v: u.statusNote })
                      if (u.waitingParts) fields.push({ k: 'Waiting', v: u.waitingParts })
                      if (u.nextStep)     fields.push({ k: 'Next', v: u.nextStep })
                      if (u.tech)         fields.push({ k: 'Tech', v: u.tech })
                      return (
                        <button
                          key={u.id}
                          onClick={() => { onClose(); if (u.ro?.id) navigate(`/ros/${u.ro.id}`) }}
                          className="w-full text-left bg-gray-800/60 border border-pink-900/30 rounded-xl px-3.5 py-3 hover:bg-gray-700/60 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Wrench size={12} className="text-pink-400 shrink-0" />
                              <span className="text-sm font-bold text-gray-100 font-mono">{u.ro?.roNumber}</span>
                              {veh && <span className="text-xs text-gray-400 truncate">{veh}</span>}
                            </div>
                            <span className="text-xs text-gray-500 shrink-0 flex items-center gap-1">
                              <Clock size={10} />
                              {formatTimeAgo(u.createdAt)}
                            </span>
                          </div>
                          {fields.length > 0 && (
                            <div className="pl-4 space-y-0.5">
                              {fields.map((f, i) => (
                                <p key={i} className="text-xs text-gray-400 truncate">
                                  <span className="text-pink-400/80 font-semibold">{f.k}:</span>{' '}
                                  <span className="text-gray-300">{f.v}</span>
                                </p>
                              ))}
                            </div>
                          )}
                          {u.createdBy && (
                            <p className="text-[10px] text-gray-600 pl-4 mt-1">by {u.createdBy}</p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function ProductionBoardV2({ hbmOnly = false }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { user } = useAuth()
  const stages = useStages()

  const [index, setIndex] = useState(0)
  const [localEdits, setLocalEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [stageOpen, setStageOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [techPickerOpen, setTechPickerOpen] = useState(false)
  const [addFlagOpen, setAddFlagOpen] = useState(false)
  const [newNoteText, setNewNoteText] = useState('')
  const [showAllNotes, setShowAllNotes] = useState(false)
  const [hbmFeedOpen, setHbmFeedOpen] = useState(false)
  const [hbmLastSeen, setHbmLastSeen] = useState(() => {
    try { return localStorage.getItem('hbmFeedLastSeen') || '' } catch { return '' }
  })

  const saveTimeout = useRef(null)

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
      queryClient.invalidateQueries({ queryKey: ['hbm-feed'] })
      setSaving(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (err) => {
      setSaving(false)
      toast.error(err.message || 'Failed to save')
    },
  })

  // Background HBM feed poll for the bell badge (main board only)
  const { data: hbmFeedData } = useQuery({
    queryKey: ['hbm-feed'],
    queryFn: () => productionApi.hbmFeed(30),
    enabled: !hbmOnly,
    refetchInterval: hbmOnly ? false : 20_000,
    refetchOnWindowFocus: true,
  })

  const hbmUnreadCount = useMemo(() => {
    if (hbmOnly || !hbmFeedData?.length) return 0
    if (!hbmLastSeen) return hbmFeedData.length
    const last = new Date(hbmLastSeen).getTime()
    return hbmFeedData.filter((u) => new Date(u.createdAt).getTime() > last).length
  }, [hbmFeedData, hbmLastSeen, hbmOnly])

  const markHbmSeen = useCallback((iso) => {
    setHbmLastSeen(iso)
    try { localStorage.setItem('hbmFeedLastSeen', iso) } catch {}
  }, [])

  const allActiveROs = useMemo(
    () =>
      (ros?.filter((r) => !r.isArchived) || []).sort(
        (a, b) => (parseInt(a.roNumber, 10) || 0) - (parseInt(b.roNumber, 10) || 0)
      ),
    [ros]
  )
  const activeROs = hbmOnly ? allActiveROs.filter((r) => r.isHBM) : allActiveROs
  const hbmCount  = allActiveROs.filter((r) => r.isHBM).length
  const currentRO = activeROs[index]
  const state = currentRO ? mergeState(currentRO, localEdits[currentRO.id]) : null

  useEffect(() => {
    setNewNoteText('')
    setShowAllNotes(false)
    setStageOpen(false)
    setMoreOpen(false)
    setTechPickerOpen(false)
    setAddFlagOpen(false)
  }, [currentRO?.id])

  const updateField = useCallback(
    (field, value) => {
      if (!currentRO) return
      const next = { ...mergeState(currentRO, localEdits[currentRO.id]), [field]: value }
      setLocalEdits((prev) => ({ ...prev, [currentRO.id]: next }))
      setSaving(true)
      setSaved(false)
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
      saveTimeout.current = setTimeout(() => {
        mutation.mutate({ roId: currentRO.id, data: next })
      }, 1000)
    },
    [currentRO, localEdits, mutation]
  )

  const toggleFlag = (key) => updateField(key, !state[key])

  const advanceStage = () => {
    if (!state) return
    const i = stages.indexOf(state.productionStage)
    if (i === -1 || i >= stages.length - 1) return
    const next = stages[i + 1]
    updateField('productionStage', next)
    toast.success(`Moved to ${next}`)
  }

  const addNote = () => {
    const text = newNoteText.trim()
    if (!text || !state) return
    const header = buildNoteHeader(user?.username)
    const existing = (state.productionStatusNote || '').trim()
    const next = existing ? `${existing}\n\n${header}\n${text}` : `${header}\n${text}`
    updateField('productionStatusNote', next)
    setNewNoteText('')
    setShowAllNotes(false)
  }

  const goPrev = () => index > 0 && setIndex((i) => i - 1)
  const goNext = () => index < activeROs.length - 1 && setIndex((i) => i + 1)

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner size="lg" /></div>
  }
  if (!currentRO) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-gray-500 p-8">
        {hbmOnly ? <Wrench size={40} className="mb-3 opacity-30 text-pink-400" /> : <Car size={40} className="mb-3 opacity-30" />}
        <p className="text-base font-semibold text-gray-300">
          {hbmOnly ? 'No vehicles flagged for HBM' : 'No active ROs'}
        </p>
        {hbmOnly && <p className="text-xs text-gray-500 mt-1.5">Flip cars to HBM from the main board</p>}
        <button onClick={() => navigate(hbmOnly ? '/board/v2' : '/')} className="mt-6 text-sm text-blue-400 hover:text-blue-300">
          {hbmOnly ? '← Back to main board' : 'Back home'}
        </button>
      </div>
    )
  }

  const stageIdx = stages.indexOf(state.productionStage)
  const nextStage = stageIdx >= 0 && stageIdx < stages.length - 1 ? stages[stageIdx + 1] : null
  const stageCls = STAGE_COLORS[state.productionStage] || 'bg-blue-900/40 text-blue-300'
  const notes = parseStatusNotes(state.productionStatusNote)
  const visibleNotes = showAllNotes ? notes : notes.slice(0, 2)

  const activeFlags = []
  if (currentRO.isBmw)              activeFlags.push({ tone: 'blue',    icon: Shield,        label: 'BMW' })
  if (state.isHBM)                  activeFlags.push({ tone: 'pink',    icon: Wrench,        label: 'HBM',                   onRemove: () => updateField('isHBM', false) })
  if (state.isTotalLoss)            activeFlags.push({ tone: state.totalLossReleased ? 'emerald' : 'purple', icon: AlertTriangle, label: state.totalLossReleased ? 'TL · Released' : 'Total Loss', onRemove: () => updateField('isTotalLoss', false) })
  if (state.prestorageActive)       activeFlags.push({ tone: 'orange',  icon: Warehouse,     label: 'Pre-Storage',           onRemove: () => updateField('prestorageActive', false) })
  if (state.productionFinalSupplement) activeFlags.push({ tone: 'amber', icon: FileText,    label: 'Final Supp',             onRemove: () => updateField('productionFinalSupplement', false) })

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* ─── Top bar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-2 border-b border-gray-800/60">
        <div className="flex items-center gap-2 min-w-0">
          {hbmOnly ? (
            <button
              onClick={() => navigate('/board/v2')}
              className="flex items-center gap-1.5 text-xs font-bold text-pink-300 hover:text-pink-200 px-2 py-1 rounded-lg bg-pink-950/40 border border-pink-500/40"
              title="Back to main board"
            >
              <ChevronLeft size={13} /> HBM
            </button>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-400 shrink-0">
              <Sparkles size={11} className="inline mr-1 -mt-0.5" /> New
            </span>
          )}
          <span className="text-xs text-gray-500">·</span>
          <span className="text-xs text-gray-400 font-mono">{index + 1} / {activeROs.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mr-1">
            {saving && <><Spinner size="sm" /><span>Saving…</span></>}
            {!saving && saved && <><Check size={13} className="text-emerald-400" /><span className="text-emerald-400">Saved</span></>}
          </div>
          {!hbmOnly && (
            <button
              onClick={() => navigate('/board/v2/hbm')}
              className="flex items-center gap-1.5 text-xs text-pink-400 hover:text-pink-300 px-2 py-1 rounded-lg bg-pink-950/40 border border-pink-900/50 transition-colors"
              title="HBM board — vehicles assigned to our sister shop"
            >
              <Wrench size={13} />
              HBM{hbmCount > 0 ? ` (${hbmCount})` : ''}
            </button>
          )}
          {!hbmOnly && (
            <button
              onClick={() => setHbmFeedOpen(true)}
              className="relative flex items-center text-xs text-pink-300 hover:text-pink-200 px-2 py-1 rounded-lg bg-pink-950/40 border border-pink-900/50 transition-colors"
              title="HBM board activity feed"
            >
              <Bell size={13} />
              {hbmUnreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-pink-500 text-[10px] font-bold text-white flex items-center justify-center shadow-lg shadow-pink-900/50 ring-2 ring-gray-950">
                  {hbmUnreadCount > 99 ? '99+' : hbmUnreadCount}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => navigate(hbmOnly ? '/board/hbm' : '/board')}
            className="text-[11px] font-semibold text-gray-400 hover:text-gray-200 px-2 py-1 rounded-lg border border-gray-700/50 hover:border-gray-600 transition-colors"
            title="Switch back to legacy board"
          >
            Legacy ↻
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white px-2 py-1 rounded-lg bg-gray-800/60 border border-gray-700/50 transition-colors"
          >
            <Home size={13} />
          </button>
        </div>
      </div>

      {/* ─── Scrollable card body ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2" onClick={() => { setAddFlagOpen(false); setTechPickerOpen(false) }}>
        <div className="max-w-2xl mx-auto">

          {/* HEADER — RO + Vehicle */}
          <div className="mb-5">
            <div className="flex items-baseline gap-3 flex-wrap mb-1.5">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">RO</span>
              <h1 className="text-3xl font-black text-white font-mono tracking-tight leading-none">
                {currentRO.roNumber}
              </h1>
              {currentRO.ownerName && (
                <span className="text-sm text-gray-300 font-medium truncate">· {currentRO.ownerName}</span>
              )}
            </div>
            <p className="text-base font-semibold text-gray-100 truncate">
              {[currentRO.vehicleYear, currentRO.vehicleMake, currentRO.vehicleModel].filter(Boolean).join(' ') || '—'}
              {currentRO.vehicleColor && <span className="text-gray-500 font-normal"> · {currentRO.vehicleColor}</span>}
            </p>
            {currentRO.vin && (
              <p className="text-[10px] font-mono text-gray-600 mt-1 truncate">VIN {currentRO.vin}</p>
            )}
          </div>

          {/* Small chip row: insurance · parts · tech */}
          <div className="flex items-center gap-3 flex-wrap mb-4 text-[11px] text-gray-400">
            <PartsDot status={effectivePartsStatus(currentRO)} />
            {currentRO.insuranceCompany && (
              <span className="inline-flex items-center gap-1.5">
                <Shield size={11} className="text-gray-500" />
                {currentRO.insuranceCompany}
              </span>
            )}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setTechPickerOpen((o) => !o)}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border transition-colors ${
                  state.assignedTech
                    ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                    : 'bg-gray-800/40 border-dashed border-gray-700 text-gray-500 hover:border-gray-600'
                }`}
              >
                <User size={11} />
                {state.assignedTech || 'Assign Tech'}
              </button>
              <AnimatePresence>
                <TechPicker
                  open={techPickerOpen}
                  value={state.assignedTech}
                  onChange={(v) => updateField('assignedTech', v)}
                  onClose={() => setTechPickerOpen(false)}
                />
              </AnimatePresence>
            </div>
          </div>

          {/* ACTIVE FLAGS — only render if anything is active */}
          {activeFlags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-5">
              {activeFlags.map((f, i) => <FlagChip key={i} {...f} />)}
            </div>
          )}

          {/* ─── HERO STAGE CARD ──────────────────────────────────── */}
          <div className={`rounded-3xl border-2 ${
            stageIdx >= 0 ? 'border-blue-500/30' : 'border-gray-700/40'
          } bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800/40 p-6 mb-5 shadow-2xl shadow-black/30`}>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-500 mb-3">Current Stage</p>
            <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
              <div className={`inline-flex items-center px-5 py-3 rounded-2xl text-2xl font-black tracking-tight ${stageCls} shadow-lg ring-2 ring-white/10`}>
                {state.productionStage}
              </div>
              <button
                onClick={() => setStageOpen(true)}
                className="text-xs font-semibold text-gray-400 hover:text-gray-200 underline-offset-4 hover:underline"
              >
                Change…
              </button>
            </div>
            {nextStage ? (
              <button
                onClick={advanceStage}
                className="w-full flex items-center justify-between gap-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition-colors rounded-2xl px-5 py-4 shadow-lg shadow-blue-900/30"
              >
                <div className="text-left">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-blue-200/80">Move to next stage</p>
                  <p className="text-base font-bold text-white">{nextStage}</p>
                </div>
                <ArrowRight size={20} className="text-white shrink-0" />
              </button>
            ) : (
              <div className="w-full text-center text-xs font-bold uppercase tracking-wider text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl py-4">
                ✓ Final Stage
              </div>
            )}
          </div>

          {/* ─── NOTES FEED ──────────────────────────────────────── */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                Status Notes <span className="text-gray-600">· {notes.length}</span>
              </p>
              {notes.length > 2 && (
                <button
                  onClick={() => setShowAllNotes((s) => !s)}
                  className="text-[10px] font-semibold text-blue-400 hover:text-blue-300"
                >
                  {showAllNotes ? 'Show recent' : `Show all ${notes.length}`}
                </button>
              )}
            </div>

            <div className="space-y-2 mb-3">
              {visibleNotes.length === 0 && (
                <p className="text-xs text-gray-600 italic py-2">No notes yet — add one below.</p>
              )}
              {visibleNotes.map((e, i) => (
                <div key={i} className="bg-gray-900/40 border-l-2 border-blue-500/40 pl-3 py-1.5">
                  {e.header && (
                    <p className="text-[10px] font-bold text-blue-400/90 mb-0.5">{e.header}</p>
                  )}
                  <p className="text-[13px] text-gray-200 whitespace-pre-wrap break-words leading-relaxed">{e.body}</p>
                </div>
              ))}
            </div>

            {/* Composer */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Textarea
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      addNote()
                    }
                  }}
                  rows={2}
                  placeholder="Add a note…"
                  className="bg-gray-900/40 border-gray-800"
                />
              </div>
              <button
                onClick={addNote}
                disabled={!newNoteText.trim()}
                className="px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold disabled:opacity-30 disabled:pointer-events-none transition-colors shrink-0"
              >
                Add
              </button>
            </div>
          </div>

          {/* ─── ACTION ROW ─────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-2 pt-1 pb-4 border-t border-gray-800/60 mt-4">
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setAddFlagOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-gray-400 hover:text-gray-200 bg-gray-800/40 hover:bg-gray-800 border border-dashed border-gray-700 rounded-lg px-2.5 py-1.5 transition-colors"
              >
                <Plus size={11} /> Flag
              </button>
              <AnimatePresence>
                <AddFlagPopover
                  open={addFlagOpen}
                  state={state}
                  onToggle={toggleFlag}
                  onClose={() => setAddFlagOpen(false)}
                />
              </AnimatePresence>
            </div>
            <button
              onClick={() => setMoreOpen(true)}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-gray-400 hover:text-gray-200 bg-gray-800/40 hover:bg-gray-800 border border-gray-700/50 rounded-lg px-2.5 py-1.5 transition-colors"
            >
              <MoreHorizontal size={13} /> More
            </button>
          </div>

        </div>
      </div>

      {/* ─── Bottom nav ──────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pt-3 pb-safe pb-3 border-t border-gray-800/60 bg-gray-950">
        <div className="max-w-2xl mx-auto flex gap-3">
          <button
            onClick={goPrev}
            disabled={index === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 font-semibold text-sm disabled:opacity-30 disabled:pointer-events-none active:bg-gray-700 transition-colors"
          >
            <ChevronLeft size={18} /> Prev
          </button>
          <button
            onClick={goNext}
            disabled={index >= activeROs.length - 1}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 border border-blue-500 text-white font-semibold text-sm disabled:opacity-30 disabled:pointer-events-none active:bg-blue-700 transition-colors"
          >
            Next <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Sheets */}
      <StagePickerSheet
        open={stageOpen}
        onClose={() => setStageOpen(false)}
        value={state.productionStage}
        onChange={(v) => updateField('productionStage', v)}
      />
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        ro={currentRO}
        state={state}
        updateField={updateField}
      />
      <HbmFeedSheet
        open={hbmFeedOpen}
        onClose={() => setHbmFeedOpen(false)}
        onSeen={markHbmSeen}
      />
    </div>
  )
}
