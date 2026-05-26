// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION BOARD V3 — Progressive disclosure
//
// Surface area shows only what's needed at a glance:
//   - RO + vehicle header
//   - Hero stage card with one-tap "advance"
//   - 6 colored tiles (Notes / Tech / Flags / Parts / Customer / More)
//
// Each tile opens a focused sheet. No buttons-everywhere, no stacked sections.
// Shares ['production'] cache with the legacy and V2 boards so edits sync.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Check, ArrowRight, Plus, X,
  Car, Wrench, AlertTriangle, Warehouse, FileText, Shield, User,
  ExternalLink, Pencil, MessageSquare, Package, MoreHorizontal,
  Bell, Clock, Home, Sparkles,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { productionApi, techniciansApi, rosApi, useStages } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { STAGES, STAGE_COLORS, formatTimeAgo } from '@/lib/utils'
import Spinner from '@/components/ui/Spinner'
import Textarea from '@/components/ui/Textarea'
import CustomerInsuranceFields from '@/components/CustomerInsuranceFields'

// ─── Helpers ────────────────────────────────────────────────────────────────
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

// ─── Generic Bottom Sheet ───────────────────────────────────────────────────
function Sheet({ open, onClose, title, icon: Icon, accent = 'blue', children, maxHeight = '80vh' }) {
  const accentClasses = {
    blue:    'border-blue-500/30 text-blue-400',
    pink:    'border-pink-500/30 text-pink-400',
    purple:  'border-purple-500/30 text-purple-400',
    orange:  'border-orange-500/30 text-orange-400',
    emerald: 'border-emerald-500/30 text-emerald-400',
    amber:   'border-amber-500/30 text-amber-400',
    gray:    'border-gray-700/60 text-gray-400',
  }[accent] || 'border-gray-700/60 text-gray-400'
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t-2 rounded-t-3xl flex flex-col"
            style={{ maxHeight, borderTopColor: 'rgba(255,255,255,0.06)' }}
          >
            <div className={`flex items-center justify-between px-5 py-4 border-b ${accentClasses}`} style={{ borderBottomColor: 'rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2.5">
                {Icon && <Icon size={17} />}
                <h2 className="text-base font-bold text-gray-100">{title}</h2>
              </div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── Tile (the click-to-expand chip) ─────────────────────────────────────────
function Tile({ icon: Icon, label, value, accent, active, onClick }) {
  const tones = {
    blue:    { bg: 'bg-blue-950/30',    border: 'border-blue-500/30',    iconC: 'text-blue-400',    glow: 'shadow-blue-900/30'    },
    pink:    { bg: 'bg-pink-950/30',    border: 'border-pink-500/30',    iconC: 'text-pink-400',    glow: 'shadow-pink-900/30'    },
    purple:  { bg: 'bg-purple-950/30',  border: 'border-purple-500/30',  iconC: 'text-purple-400',  glow: 'shadow-purple-900/30'  },
    orange:  { bg: 'bg-orange-950/30',  border: 'border-orange-500/30',  iconC: 'text-orange-400',  glow: 'shadow-orange-900/30'  },
    emerald: { bg: 'bg-emerald-950/30', border: 'border-emerald-500/30', iconC: 'text-emerald-400', glow: 'shadow-emerald-900/30' },
    amber:   { bg: 'bg-amber-950/30',   border: 'border-amber-500/30',   iconC: 'text-amber-400',   glow: 'shadow-amber-900/30'   },
    gray:    { bg: 'bg-gray-800/40',    border: 'border-gray-700/40',    iconC: 'text-gray-500',    glow: 'shadow-black/20'       },
    red:     { bg: 'bg-red-950/30',     border: 'border-red-500/30',     iconC: 'text-red-400',     glow: 'shadow-red-900/30'     },
  }
  const t = tones[accent] || tones.gray
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border ${active ? t.border : 'border-gray-700/40'} ${active ? t.bg : 'bg-gray-800/30'} hover:border-gray-600/60 active:scale-[0.98] transition-all px-4 py-3.5 shadow-lg ${active ? t.glow : ''}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className={active ? t.iconC : 'text-gray-500'} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      <p className={`text-sm font-bold truncate ${active ? 'text-white' : 'text-gray-400'}`}>
        {value || <span className="text-gray-600 font-normal">—</span>}
      </p>
    </button>
  )
}

// ─── Sheets ─────────────────────────────────────────────────────────────────
function NotesSheet({ open, onClose, value, onAddNote }) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const entries = parseStatusNotes(value)

  useEffect(() => {
    if (open) setText('')
  }, [open])

  const submit = () => {
    const t = text.trim()
    if (!t) return
    onAddNote(t)
    setText('')
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Notes · ${entries.length}`} icon={MessageSquare} accent="blue">
      <div className="space-y-2.5 mb-5">
        {entries.length === 0 && (
          <p className="text-sm text-gray-500 italic">No notes yet — add the first one below.</p>
        )}
        {entries.map((e, i) => (
          <div key={i} className="border-l-2 border-blue-500/40 pl-3 py-1">
            {e.header && (
              <p className="text-[10px] font-bold text-blue-400/90 mb-0.5 uppercase tracking-wide">{e.header}</p>
            )}
            <p className="text-[13px] text-gray-200 whitespace-pre-wrap break-words leading-relaxed">{e.body}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-800 pt-4">
        <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2 block">Add a note</label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() }
          }}
          rows={3}
          placeholder="Type a note — gets stamped with your name and time…"
        />
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="w-full mt-3 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          Add Note
        </button>
      </div>
    </Sheet>
  )
}

function TechSheet({ open, onClose, value, onChange }) {
  const { data: techs } = useQuery({
    queryKey: ['technicians'],
    queryFn: () => techniciansApi.list(),
    staleTime: 60_000,
  })
  return (
    <Sheet open={open} onClose={onClose} title="Assign Technician" icon={User} accent="blue">
      <button
        onClick={() => { onChange(''); onClose() }}
        className={`w-full text-left px-4 py-3 rounded-xl border mb-2 transition-colors ${
          !value
            ? 'bg-gray-800 border-gray-600 text-gray-200'
            : 'bg-gray-800/40 border-gray-700/50 text-gray-400 hover:border-gray-600'
        }`}
      >
        {!value && <Check size={14} className="inline mr-2 text-emerald-400" />}
        Unassigned
      </button>
      <div className="space-y-1.5">
        {(techs || []).map((t) => (
          <button
            key={t.id}
            onClick={() => { onChange(t.name); onClose() }}
            className={`w-full text-left px-4 py-3 rounded-xl border transition-colors flex items-center gap-3 ${
              value === t.name
                ? 'bg-blue-500/15 border-blue-500/60 text-blue-200'
                : 'bg-gray-800/40 border-gray-700/50 text-gray-300 hover:border-blue-500/40'
            }`}
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-white">{t.name?.[0]?.toUpperCase()}</span>
            </div>
            <span className="text-sm font-semibold flex-1">{t.name}</span>
            {value === t.name && <Check size={15} className="text-blue-400" />}
          </button>
        ))}
        {(!techs || techs.length === 0) && (
          <p className="text-sm text-gray-500 italic p-2">No technicians configured — add them in Admin.</p>
        )}
      </div>
    </Sheet>
  )
}

function FlagsSheet({ open, onClose, ro, state, updateField }) {
  const items = [
    { key: 'isBmw',                     label: 'BMW Job',           desc: 'BMW certified vehicle',                icon: Shield,        tone: 'blue',   isRoLevel: true },
    { key: 'isHBM',                     label: 'HBM (sister shop)', desc: 'Assigned to HBM — shows on HBM board', icon: Wrench,        tone: 'pink'   },
    { key: 'isTotalLoss',               label: 'Total Loss',        desc: 'Insurance has totaled the vehicle',    icon: AlertTriangle, tone: 'purple' },
    { key: 'prestorageActive',          label: 'Pre-Storage',       desc: 'Accruing storage fees',                icon: Warehouse,     tone: 'orange' },
    { key: 'productionFinalSupplement', label: 'Final Supplement',  desc: 'Awaiting final supplement approval',   icon: FileText,      tone: 'amber'  },
  ]
  const toneToggle = {
    blue:    { on: 'bg-blue-500',    bg: 'bg-blue-950/40    border-blue-500/60',    txt: 'text-blue-200',    iconC: 'text-blue-300'   },
    pink:    { on: 'bg-pink-500',    bg: 'bg-pink-950/50    border-pink-500/60',    txt: 'text-pink-200',    iconC: 'text-pink-300'   },
    purple:  { on: 'bg-purple-500',  bg: 'bg-purple-950/50  border-purple-500/60',  txt: 'text-purple-200',  iconC: 'text-purple-300' },
    orange:  { on: 'bg-orange-500',  bg: 'bg-orange-950/50  border-orange-500/60',  txt: 'text-orange-200',  iconC: 'text-orange-300' },
    amber:   { on: 'bg-amber-500',   bg: 'bg-amber-950/40   border-amber-500/50',   txt: 'text-amber-200',   iconC: 'text-amber-300'  },
  }
  return (
    <Sheet open={open} onClose={onClose} title="Flags" icon={Shield} accent="purple">
      <div className="space-y-2.5">
        {items.map(({ key, label, desc, icon: Icon, tone, isRoLevel }) => {
          const on = isRoLevel ? !!ro[key] : !!state[key]
          const t = toneToggle[tone]
          return (
            <button
              key={key}
              onClick={() => updateField(key, !on)}
              className={`w-full flex items-start gap-3.5 px-4 py-3.5 rounded-2xl border transition-all ${
                on ? t.bg : 'bg-gray-800/30 border-gray-700/40 hover:border-gray-600'
              }`}
            >
              <div className={`w-12 h-6 rounded-full relative flex items-center shrink-0 mt-0.5 ${on ? t.on : 'bg-gray-700'}`}>
                <motion.div
                  animate={{ x: on ? 24 : 2 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="w-5 h-5 bg-white rounded-full shadow"
                />
              </div>
              <div className="flex-1 text-left">
                <p className={`text-sm font-bold flex items-center gap-1.5 ${on ? t.txt : 'text-gray-200'}`}>
                  <Icon size={13} className={on ? t.iconC : 'text-gray-500'} /> {label}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
              </div>
            </button>
          )
        })}

        {/* Total Loss sub-controls */}
        <AnimatePresence>
          {state.isTotalLoss && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="ml-1 pl-4 border-l-2 border-purple-500/40 py-2.5 mt-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-purple-400 mb-2">Released to Insurance?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateField('totalLossReleased', true)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                      state.totalLossReleased ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-900/40' : 'bg-gray-800 border border-gray-700 text-gray-400'
                    }`}
                  >YES</button>
                  <button
                    onClick={() => updateField('totalLossReleased', false)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                      !state.totalLossReleased ? 'bg-red-600 text-white shadow-lg shadow-red-900/40' : 'bg-gray-800 border border-gray-700 text-gray-400'
                    }`}
                  >NO</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Sheet>
  )
}

function PartsSheet({ open, onClose, ro }) {
  const parts = ro?.parts || []
  const received = parts.filter((p) => p.isReceived)
  const pending  = parts.filter((p) => !p.isReceived)
  return (
    <Sheet open={open} onClose={onClose} title={`Parts · ${parts.length}`} icon={Package} accent="emerald">
      {parts.length === 0 && (
        <p className="text-sm text-gray-500 italic text-center py-6">No parts on this RO yet</p>
      )}
      {pending.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-400 mb-2">Pending · {pending.length}</p>
          <div className="space-y-1.5">
            {pending.map((p) => (
              <div key={p.id} className="bg-red-950/20 border border-red-500/20 rounded-xl px-3.5 py-2.5">
                <p className="text-sm text-gray-100 truncate">{p.description || p.partNumber || 'Untitled part'}</p>
                {p.partNumber && p.description && <p className="text-[11px] font-mono text-gray-500 mt-0.5">{p.partNumber}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
      {received.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-2">Received · {received.length}</p>
          <div className="space-y-1.5">
            {received.map((p) => (
              <div key={p.id} className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl px-3.5 py-2.5">
                <p className="text-sm text-gray-100 truncate">{p.description || p.partNumber || 'Untitled part'}</p>
                {p.partNumber && p.description && <p className="text-[11px] font-mono text-gray-500 mt-0.5">{p.partNumber}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  )
}

function CustomerSheet({ open, onClose, ro }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({})

  useEffect(() => {
    if (open && ro) {
      setForm({
        roNumber:         ro.roNumber          || '',
        isBmw:            ro.isBmw             || false,
        ownerName:        ro.ownerName         || '',
        ownerPhone:       ro.ownerPhone        || '',
        ownerPhone2:      ro.ownerPhone2       || '',
        ownerEmail:       ro.ownerEmail        || '',
        insuranceCompany: ro.insuranceCompany  || '',
        claimNumber:      ro.claimNumber       || '',
        policyNumber:     ro.policyNumber      || '',
        adjusterName:     ro.adjusterName      || '',
        adjusterPhone:    ro.adjusterPhone     || '',
        deductible:       ro.deductible != null ? String(ro.deductible) : '',
        dateOfLoss:       ro.dateOfLoss ? new Date(ro.dateOfLoss).toISOString().slice(0, 10) : '',
      })
    }
  }, [open, ro])

  const mutation = useMutation({
    mutationFn: (data) => rosApi.update(ro.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production'] })
      toast.success('Customer info saved')
      onClose()
    },
    onError: (err) => toast.error(err.message || 'Failed to save'),
  })

  const handleChange = (field, val) => setForm((p) => ({ ...p, [field]: val }))

  const handleSave = () => {
    const data = { ...form }
    if (data.deductible !== '') data.deductible = parseFloat(data.deductible) || 0
    else data.deductible = null
    if (!data.dateOfLoss) data.dateOfLoss = null
    mutation.mutate(data)
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Edit RO · #${ro?.roNumber}`} icon={Pencil} accent="blue" maxHeight="85vh">
      <div className="space-y-4">
        <div className="bg-gray-800/40 border border-gray-700/50 rounded-2xl p-3 space-y-3">
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">RO Number</label>
            <input
              type="text"
              value={form.roNumber || ''}
              onChange={(e) => handleChange('roNumber', e.target.value)}
              className="w-full bg-gray-900/70 border border-gray-700/60 focus:border-blue-500/60 rounded-xl px-3.5 py-2.5 text-sm text-gray-100 font-mono outline-none transition-all"
            />
          </div>
          <button
            type="button"
            onClick={() => handleChange('isBmw', !form.isBmw)}
            className={`w-full flex items-center gap-3 rounded-xl p-3 border transition-all ${
              form.isBmw
                ? 'bg-blue-950/50 border-blue-500/60'
                : 'bg-gray-900/40 border-gray-700/50 hover:border-gray-600'
            }`}
          >
            <div className={`w-12 h-6 rounded-full relative flex items-center shrink-0 ${form.isBmw ? 'bg-blue-500' : 'bg-gray-700'}`}>
              <motion.div animate={{ x: form.isBmw ? 24 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} className="w-5 h-5 bg-white rounded-full shadow-md absolute" />
            </div>
            <div className="text-left">
              <p className={`text-sm font-bold ${form.isBmw ? 'text-blue-300' : 'text-gray-200'}`}>BMW Job</p>
            </div>
          </button>
        </div>
        <CustomerInsuranceFields form={form} onChange={handleChange} showHeaders={true} density="compact" />
        <button
          onClick={handleSave}
          disabled={mutation.isPending}
          className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2"
        >
          {mutation.isPending ? <Spinner size="sm" /> : <Check size={15} />}
          Save Changes
        </button>
      </div>
    </Sheet>
  )
}

function StagePickerSheet({ open, onClose, value, onChange }) {
  const stages = useStages()
  return (
    <Sheet open={open} onClose={onClose} title="Change Stage" icon={ArrowRight} accent="blue">
      <div className="grid grid-cols-2 gap-2">
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
    </Sheet>
  )
}

function MoreSheet({ open, onClose, ro, navigate }) {
  if (!ro) return null
  const items = [
    { icon: ExternalLink, label: 'Open full RO detail', action: () => navigate(`/ros/${ro.id}`) },
    { icon: FileText,     label: 'Status log',          action: () => navigate('/board/log') },
  ]
  return (
    <Sheet open={open} onClose={onClose} title={`More · #${ro.roNumber}`} icon={MoreHorizontal} accent="gray">
      <div className="space-y-2">
        {items.map(({ icon: Icon, label, action }) => (
          <button
            key={label}
            onClick={() => { onClose(); action() }}
            className="w-full flex items-center justify-between gap-2 bg-gray-800/60 border border-gray-700/50 hover:border-blue-500/40 rounded-xl px-3.5 py-3 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Icon size={14} className="text-blue-400" />
              <span className="text-sm font-semibold text-gray-100">{label}</span>
            </div>
            <ChevronRight size={16} className="text-gray-500" />
          </button>
        ))}
      </div>
    </Sheet>
  )
}

// ─── HBM activity feed sheet ────────────────────────────────────────────────
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
    <Sheet open={open} onClose={onClose} title="HBM Board Activity" icon={Wrench} accent="pink">
      <div className="space-y-5">
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
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function ProductionBoardV3({ hbmOnly = false }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { user } = useAuth()
  const stages = useStages()

  const [index, setIndex] = useState(0)
  const [localEdits, setLocalEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Sheets
  const [notesOpen, setNotesOpen] = useState(false)
  const [techOpen, setTechOpen] = useState(false)
  const [flagsOpen, setFlagsOpen] = useState(false)
  const [partsOpen, setPartsOpen] = useState(false)
  const [customerOpen, setCustomerOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [stageOpen, setStageOpen] = useState(false)
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
      setTimeout(() => setSaved(false), 1800)
    },
    onError: (err) => { setSaving(false); toast.error(err.message || 'Failed to save') },
  })

  // RO-level updates (roNumber, isBmw) — uses /api/ros/:id
  const roMutation = useMutation({
    mutationFn: ({ roId, data }) => rosApi.update(roId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['production'] }),
  })

  // Background HBM feed for bell badge
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
  const state     = currentRO ? mergeState(currentRO, localEdits[currentRO.id]) : null

  useEffect(() => {
    // Close all sheets on RO change
    setNotesOpen(false); setTechOpen(false); setFlagsOpen(false)
    setPartsOpen(false); setCustomerOpen(false); setMoreOpen(false)
    setStageOpen(false)
  }, [currentRO?.id])

  const updateField = useCallback(
    (field, value) => {
      if (!currentRO) return
      // RO-level fields go through rosApi
      if (field === 'isBmw') {
        roMutation.mutate({ roId: currentRO.id, data: { isBmw: value } })
        return
      }
      const next = { ...mergeState(currentRO, localEdits[currentRO.id]), [field]: value }
      setLocalEdits((prev) => ({ ...prev, [currentRO.id]: next }))
      setSaving(true)
      setSaved(false)
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
      saveTimeout.current = setTimeout(() => {
        mutation.mutate({ roId: currentRO.id, data: next })
      }, 1000)
    },
    [currentRO, localEdits, mutation, roMutation]
  )

  const addNote = (text) => {
    if (!state) return
    const header = buildNoteHeader(user?.username)
    const existing = (state.productionStatusNote || '').trim()
    const next = existing ? `${existing}\n\n${header}\n${text}` : `${header}\n${text}`
    updateField('productionStatusNote', next)
    toast.success('Note added')
  }

  const advanceStage = () => {
    if (!state) return
    const i = stages.indexOf(state.productionStage)
    if (i === -1 || i >= stages.length - 1) return
    const next = stages[i + 1]
    updateField('productionStage', next)
    toast.success(`Moved to ${next}`)
  }

  const goPrev = () => index > 0 && setIndex((i) => i - 1)
  const goNext = () => index < activeROs.length - 1 && setIndex((i) => i + 1)

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Spinner size="lg" /></div>

  if (!currentRO) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-gray-500 p-8 bg-gray-950">
        {hbmOnly ? <Wrench size={40} className="mb-3 opacity-30 text-pink-400" /> : <Car size={40} className="mb-3 opacity-30" />}
        <p className="text-base font-semibold text-gray-300">{hbmOnly ? 'No vehicles flagged for HBM' : 'No active ROs'}</p>
        <button onClick={() => navigate(hbmOnly ? '/board/v3' : '/')} className="mt-6 text-sm text-blue-400 hover:text-blue-300">
          {hbmOnly ? '← Back to main board' : 'Back home'}
        </button>
      </div>
    )
  }

  const stageIdx = stages.indexOf(state.productionStage)
  const nextStage = stageIdx >= 0 && stageIdx < stages.length - 1 ? stages[stageIdx + 1] : null
  const stageCls  = STAGE_COLORS[state.productionStage] || 'bg-blue-900/40 text-blue-300'
  const partsStatus = effectivePartsStatus(currentRO)

  // Tile values
  const noteCount = parseStatusNotes(state.productionStatusNote).length
  const activeFlagCount = [
    currentRO.isBmw,
    state.isHBM,
    state.isTotalLoss,
    state.prestorageActive,
    state.productionFinalSupplement,
  ].filter(Boolean).length

  const partsAccent = partsStatus === 'ALL_HERE' ? 'emerald' : partsStatus === 'ACKNOWLEDGED' ? 'amber' : 'red'
  const partsLabel  = partsStatus === 'ALL_HERE' ? 'All Here' : partsStatus === 'ACKNOWLEDGED' ? 'Ack' : 'Missing'

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Top bar */}
      <div className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-2 border-b border-gray-800/60">
        <div className="flex items-center gap-2 min-w-0">
          {hbmOnly ? (
            <button
              onClick={() => navigate('/board/v3')}
              className="flex items-center gap-1.5 text-xs font-bold text-pink-300 hover:text-pink-200 px-2 py-1 rounded-lg bg-pink-950/40 border border-pink-500/40"
            >
              <ChevronLeft size={13} /> HBM
            </button>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-400 shrink-0">
              <Sparkles size={11} className="inline mr-1 -mt-0.5" /> V3
            </span>
          )}
          <span className="text-xs text-gray-500">·</span>
          <span className="text-xs text-gray-400 font-mono">{index + 1} / {activeROs.length}</span>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 ml-2">
            {saving && <><Spinner size="sm" /><span>Saving…</span></>}
            {!saving && saved && <><Check size={13} className="text-emerald-400" /><span className="text-emerald-400">Saved</span></>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {!hbmOnly && (
            <button
              onClick={() => navigate('/board/v3/hbm')}
              className="flex items-center gap-1.5 text-xs text-pink-400 hover:text-pink-300 px-2 py-1 rounded-lg bg-pink-950/40 border border-pink-900/50 transition-colors"
              title="HBM board"
            >
              <Wrench size={13} />
              HBM{hbmCount > 0 ? ` (${hbmCount})` : ''}
            </button>
          )}
          {!hbmOnly && (
            <button
              onClick={() => setHbmFeedOpen(true)}
              className="relative flex items-center text-xs text-pink-300 hover:text-pink-200 px-2 py-1 rounded-lg bg-pink-950/40 border border-pink-900/50 transition-colors"
              title="HBM activity feed"
            >
              <Bell size={13} />
              {hbmUnreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-pink-500 text-[10px] font-bold text-white flex items-center justify-center shadow-lg ring-2 ring-gray-950">
                  {hbmUnreadCount > 99 ? '99+' : hbmUnreadCount}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => navigate(hbmOnly ? '/board/hbm' : '/board')}
            className="text-[11px] font-semibold text-gray-400 hover:text-gray-200 px-2 py-1 rounded-lg border border-gray-700/50 hover:border-gray-600 transition-colors"
            title="Legacy board"
          >
            Legacy ↻
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center text-xs text-gray-300 hover:text-white px-2 py-1 rounded-lg bg-gray-800/60 border border-gray-700/50 transition-colors"
            title="Home"
          >
            <Home size={13} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 pt-5 pb-3">
        <div className="max-w-2xl mx-auto">

          {/* Header */}
          <div className="mb-6">
            <div className="flex items-baseline gap-3 flex-wrap mb-1">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">RO</span>
              <h1 className="text-4xl font-black text-white font-mono tracking-tight leading-none">
                {currentRO.roNumber}
              </h1>
            </div>
            {currentRO.ownerName && (
              <p className="text-base text-gray-300 font-semibold mb-1">{currentRO.ownerName}</p>
            )}
            <p className="text-sm text-gray-400 truncate">
              {[currentRO.vehicleYear, currentRO.vehicleMake, currentRO.vehicleModel].filter(Boolean).join(' ') || '—'}
              {currentRO.vehicleColor && <span className="text-gray-600"> · {currentRO.vehicleColor}</span>}
            </p>
          </div>

          {/* Hero stage card */}
          <div className={`rounded-3xl border-2 ${
            stageIdx >= 0 ? 'border-blue-500/30' : 'border-gray-700/40'
          } bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800/40 p-6 mb-5 shadow-2xl shadow-black/30`}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-500">Current Stage</p>
              <button
                onClick={() => setStageOpen(true)}
                className="text-[11px] font-semibold text-gray-500 hover:text-gray-300 transition-colors"
              >
                Change…
              </button>
            </div>
            <div className={`inline-flex items-center px-5 py-3 rounded-2xl text-2xl font-black tracking-tight ${stageCls} shadow-lg ring-2 ring-white/10 mb-5`}>
              {state.productionStage}
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

          {/* Tile grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <Tile
              icon={MessageSquare}
              label="Notes"
              value={noteCount > 0 ? `${noteCount} ${noteCount === 1 ? 'entry' : 'entries'}` : 'None yet'}
              accent="blue"
              active={noteCount > 0}
              onClick={() => setNotesOpen(true)}
            />
            <Tile
              icon={User}
              label="Tech"
              value={state.assignedTech || 'Unassigned'}
              accent="blue"
              active={!!state.assignedTech}
              onClick={() => setTechOpen(true)}
            />
            <Tile
              icon={Shield}
              label="Flags"
              value={activeFlagCount > 0 ? `${activeFlagCount} active` : 'None'}
              accent={state.isTotalLoss ? 'purple' : state.isHBM ? 'pink' : state.prestorageActive ? 'orange' : currentRO.isBmw ? 'blue' : 'amber'}
              active={activeFlagCount > 0}
              onClick={() => setFlagsOpen(true)}
            />
            <Tile
              icon={Package}
              label="Parts"
              value={partsLabel}
              accent={partsAccent}
              active={true}
              onClick={() => setPartsOpen(true)}
            />
            <Tile
              icon={Pencil}
              label="Customer"
              value={currentRO.insuranceCompany || (currentRO.ownerName ? 'Edit info' : 'Add info')}
              accent="blue"
              active={!!currentRO.insuranceCompany || !!currentRO.ownerName}
              onClick={() => setCustomerOpen(true)}
            />
            <Tile
              icon={MoreHorizontal}
              label="More"
              value="Status log, full RO"
              accent="gray"
              active={false}
              onClick={() => setMoreOpen(true)}
            />
          </div>

        </div>
      </div>

      {/* Bottom nav */}
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
      <NotesSheet
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        value={state.productionStatusNote}
        onAddNote={addNote}
      />
      <TechSheet
        open={techOpen}
        onClose={() => setTechOpen(false)}
        value={state.assignedTech}
        onChange={(v) => updateField('assignedTech', v)}
      />
      <FlagsSheet
        open={flagsOpen}
        onClose={() => setFlagsOpen(false)}
        ro={currentRO}
        state={state}
        updateField={updateField}
      />
      <PartsSheet open={partsOpen} onClose={() => setPartsOpen(false)} ro={currentRO} />
      <CustomerSheet open={customerOpen} onClose={() => setCustomerOpen(false)} ro={currentRO} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} ro={currentRO} navigate={navigate} />
      <HbmFeedSheet open={hbmFeedOpen} onClose={() => setHbmFeedOpen(false)} onSeen={markHbmSeen} />
    </div>
  )
}
