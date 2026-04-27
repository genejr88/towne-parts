import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Lock, Plus, Pencil, Trash2, Check, X, ChevronLeft, ChevronRight,
  Upload, Camera, FileText, Image, BarChart3, ArrowLeftRight,
  DollarSign, TrendingUp, Clock, CheckCircle2,
} from 'lucide-react'
import { bmwApi, privateApi } from '@/lib/api'
import Spinner from '@/components/ui/Spinner'

// ── Helpers ────────────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmt$(n) {
  if (n == null) return '—'
  return '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`
}

function isImage(filename) {
  return /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp)$/i.test(filename || '')
}

// ── Month / Year tab list ──────────────────────────────────────────────────────
// Generate list of months from Nov 2024 → current month
function generateMonthList() {
  const list = []
  const start = { year: 2024, month: 11 }
  const now = new Date()
  let { year, month } = start
  while (year < now.getFullYear() || (year === now.getFullYear() && month <= now.getMonth() + 1)) {
    list.push({ year, month })
    month++
    if (month > 12) { month = 1; year++ }
  }
  return list
}

// ── Small stat card ────────────────────────────────────────────────────────────
function Stat({ label, value, sub, color = 'text-gray-100' }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/40 rounded-xl p-3.5 flex flex-col gap-1">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-xl font-black tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-600">{sub}</p>}
    </div>
  )
}

// ── Row editor modal ───────────────────────────────────────────────────────────
function EntryModal({ entry, month, year, pin, onClose, onSaved }) {
  const isNew = !entry
  const [form, setForm] = useState({
    date:      entry?.date ? entry.date.split('T')[0] : '',
    lastName:  entry?.lastName  || '',
    bmwNumber: entry?.bmwNumber || '',
    roNumber:  entry?.roNumber  || '',
    amount:    entry?.amount != null ? String(entry.amount) : '',
    status:    entry?.status || 'NOT_RECEIVED',
    notes:     entry?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.lastName.trim()) { setErr('Last name is required'); return }
    setSaving(true)
    setErr('')
    try {
      const payload = {
        month, year,
        date:      form.date || null,
        lastName:  form.lastName.trim() || null,
        bmwNumber: form.bmwNumber.trim() || null,
        roNumber:  form.roNumber.trim()  || null,
        amount:    form.amount !== '' ? parseFloat(form.amount) : null,
        status:    form.status,
        notes:     form.notes.trim() || null,
      }
      if (isNew) {
        await bmwApi.create(pin, payload)
      } else {
        await bmwApi.update(pin, entry.id, payload)
      }
      onSaved()
      onClose()
    } catch (e) {
      setErr(e.message || 'Save failed')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', damping: 22, stiffness: 300 }}
        className="relative w-full max-w-sm bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl p-5 z-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-gray-100">{isNew ? 'Add Entry' : 'Edit Entry'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-700/50">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" type="date" value={form.date} onChange={v => set('date', v)} />
            <Field label="Last Name" value={form.lastName} onChange={v => set('lastName', v)} placeholder="Smith" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="M# / BMW#" value={form.bmwNumber} onChange={v => set('bmwNumber', v)} placeholder="m1045" />
            <Field label="RO#" value={form.roNumber} onChange={v => set('roNumber', v)} placeholder="5501" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" type="number" value={form.amount} onChange={v => set('amount', v)} placeholder="0.00" step="0.01" />
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Status</label>
              <div className="flex gap-2">
                {['NOT_RECEIVED','RECEIVED'].map(s => (
                  <button
                    key={s}
                    onClick={() => set('status', s)}
                    className={`flex-1 py-2 rounded-lg text-[11px] font-semibold border transition-all ${
                      form.status === s
                        ? s === 'RECEIVED'
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                          : 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                        : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600'
                    }`}
                  >
                    {s === 'RECEIVED' ? 'Received' : 'Pending'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Field label="Notes (optional)" value={form.notes} onChange={v => set('notes', v)} placeholder="Any notes…" />
        </div>

        {err && <p className="text-xs text-red-400 mt-2">{err}</p>}

        <div className="flex gap-2.5 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm text-white font-semibold transition-colors"
          >
            {saving ? 'Saving…' : isNew ? 'Add' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, step }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        step={step}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500"
      />
    </div>
  )
}

// ── Compare Panel ──────────────────────────────────────────────────────────────
function ComparePanel({ summary }) {
  const [aKey, setAKey] = useState(null)
  const [bKey, setBKey] = useState(null)

  const monthKey = (s) => `${s.year}-${String(s.month).padStart(2,'0')}`
  const sorted = [...(summary || [])].sort((a,b) => monthKey(a) < monthKey(b) ? -1 : 1)
  const label = (s) => `${MONTH_NAMES[s.month-1]} ${s.year}`

  const a = sorted.find(s => monthKey(s) === aKey)
  const b = sorted.find(s => monthKey(s) === bKey)

  const diff = (field) => {
    if (!a || !b) return null
    return (parseFloat(b[field]) - parseFloat(a[field])).toFixed(2)
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/40 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-4">
        <ArrowLeftRight size={14} className="text-blue-400" />
        <h3 className="text-sm font-bold text-gray-200">Month Comparison</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {[['A', aKey, setAKey], ['B', bKey, setBKey]].map(([slot, val, setter]) => (
          <div key={slot}>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Month {slot}</label>
            <select
              value={val || ''}
              onChange={e => setter(e.target.value || null)}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
            >
              <option value="">— pick —</option>
              {sorted.map(s => (
                <option key={monthKey(s)} value={monthKey(s)}>{label(s)}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {a && b ? (
        <div className="space-y-2">
          {[
            { label: 'Invoiced', field: 'invoiced' },
            { label: 'Received', field: 'received' },
            { label: 'Outstanding', field: 'outstanding' },
            { label: 'Entries', field: 'count', noFmt: true },
          ].map(({ label, field, noFmt }) => {
            const d = parseFloat(diff(field))
            const up = d > 0
            return (
              <div key={field} className="flex items-center justify-between bg-gray-900/50 rounded-xl px-3 py-2.5">
                <span className="text-xs text-gray-400 font-medium">{label}</span>
                <div className="flex items-center gap-4 text-xs tabular-nums">
                  <span className="text-gray-300">{noFmt ? a[field] : fmt$(a[field])}</span>
                  <span className="text-gray-600">→</span>
                  <span className="text-gray-300">{noFmt ? b[field] : fmt$(b[field])}</span>
                  <span className={`font-semibold min-w-[60px] text-right ${d === 0 ? 'text-gray-500' : up ? 'text-emerald-400' : 'text-red-400'}`}>
                    {d === 0 ? '—' : `${up ? '+' : ''}${noFmt ? d : fmt$(d)}`}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-600 text-center py-4">Select two months to compare</p>
      )}
    </div>
  )
}

// ── File Card (existing) ───────────────────────────────────────────────────────
function PrivateFileCard({ file, pin, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const imgSrc = privateApi.fileViewUrl(file.id, pin)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="relative bg-gray-800/60 border border-gray-700/50 rounded-2xl overflow-hidden"
    >
      {isImage(file.originalFilename || file.storedPath) ? (
        <a href={imgSrc} target="_blank" rel="noopener noreferrer">
          <img src={imgSrc} alt={file.caption || file.originalFilename} className="w-full h-44 object-cover"
            onError={e => { e.target.style.display = 'none' }} />
        </a>
      ) : (
        <a href={imgSrc} target="_blank" rel="noopener noreferrer"
          className="flex flex-col items-center justify-center h-44 gap-2 bg-gray-800/40 hover:bg-gray-700/40 transition-colors">
          <FileText size={36} className="text-gray-500" />
          <span className="text-xs text-gray-400 px-3 text-center truncate max-w-full">
            {file.originalFilename || file.storedPath}
          </span>
        </a>
      )}
      <div className="px-3 py-2.5">
        {file.caption && <p className="text-sm text-gray-200 font-medium leading-snug">{file.caption}</p>}
        <p className="text-[11px] text-gray-500 mt-0.5">
          {new Date(file.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      </div>
      <div className="absolute top-2 right-2">
        {confirmDelete ? (
          <div className="flex gap-1.5">
            <button onClick={() => onDelete(file.id)} className="px-2.5 py-1 text-xs font-semibold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors">Delete</button>
            <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 text-xs bg-gray-800/90 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"><X size={12} /></button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="p-1.5 bg-gray-900/70 rounded-lg text-gray-400 hover:text-red-400 transition-colors backdrop-blur-sm">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </motion.div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
const TABS = ['tracker', 'compare', 'files']
const MONTHS = generateMonthList()

export default function SecureVault() {
  const navigate   = useNavigate()
  const queryClient = useQueryClient()
  const pin = sessionStorage.getItem('private_pin')

  const [activeTab, setActiveTab]   = useState('tracker')
  const [monthIdx, setMonthIdx]     = useState(() => MONTHS.length - 1) // default to latest
  const [editEntry, setEditEntry]   = useState(null)       // null = closed, false = new, obj = edit
  const [deleteId, setDeleteId]     = useState(null)

  // File upload state
  const fileInputRef = useRef(null)
  const [caption, setCaption]       = useState('')
  const [uploading, setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState('')

  useEffect(() => { if (!pin) navigate('/', { replace: true }) }, [pin, navigate])

  const { month, year } = MONTHS[monthIdx] || {}

  // Tracker data
  const { data: payments = [], isLoading: loadingPayments } = useQuery({
    queryKey: ['bmw-payments', month, year],
    queryFn: () => bmwApi.list(pin, month, year),
    enabled: !!pin && activeTab === 'tracker',
  })

  // Summary for compare tab
  const { data: summary = [], isLoading: loadingSummary } = useQuery({
    queryKey: ['bmw-summary'],
    queryFn: () => bmwApi.summary(pin),
    enabled: !!pin,
  })

  // Files
  const { data: files = [], isLoading: loadingFiles } = useQuery({
    queryKey: ['private-files'],
    queryFn: () => privateApi.listFiles(pin),
    enabled: !!pin && activeTab === 'files',
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => bmwApi.remove(pin, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bmw-payments'] })
      queryClient.invalidateQueries({ queryKey: ['bmw-summary'] })
      setDeleteId(null)
    },
  })

  const deleteFileMutation = useMutation({
    mutationFn: (id) => privateApi.deleteFile(pin, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['private-files'] }),
  })

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      await privateApi.uploadFile(pin, file, caption.trim() || null)
      setCaption('')
      queryClient.invalidateQueries({ queryKey: ['private-files'] })
    } catch (err) {
      setUploadError(err.message || 'Upload failed.')
    }
    setUploading(false)
    e.target.value = ''
  }

  const handleLock = () => {
    sessionStorage.removeItem('private_pin')
    navigate('/', { replace: true })
  }

  // Stats for current month
  const invoiced    = payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0)
  const received    = payments.filter(p => p.status === 'RECEIVED').reduce((s, p) => s + parseFloat(p.amount || 0), 0)
  const outstanding = invoiced - received
  const pctReceived = invoiced > 0 ? Math.round((received / invoiced) * 100) : 0

  if (!pin) return null

  return (
    <div className="px-4 py-5 pb-24 max-w-3xl mx-auto">
      {/* ── Header ── */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-black text-gray-100 tracking-tight">BMW PAYMENT TRACKER</h1>
          <p className="text-xs text-gray-600 mt-0.5">Private · secured</p>
        </div>
        <button onClick={handleLock}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-800/80 border border-gray-700/50 text-xs text-gray-400 hover:text-red-400 transition-colors">
          <Lock size={13} /> Lock
        </button>
      </motion.div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-5 bg-gray-800/50 border border-gray-700/40 rounded-xl p-1">
        {[['tracker', 'Tracker'], ['compare', 'Compare'], ['files', 'Files']].map(([t, label]) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === t
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-500 hover:text-gray-300'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── TRACKER TAB ── */}
      {activeTab === 'tracker' && (
        <div>
          {/* Month navigator */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setMonthIdx(i => Math.max(0, i - 1))}
              disabled={monthIdx === 0}
              className="p-2 rounded-xl bg-gray-800/60 border border-gray-700/40 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="text-center">
              <p className="text-lg font-black text-gray-100">{MONTH_FULL[month-1]} {year}</p>
              <p className="text-xs text-gray-600">{payments.length} entr{payments.length === 1 ? 'y' : 'ies'}</p>
            </div>
            <button
              onClick={() => setMonthIdx(i => Math.min(MONTHS.length - 1, i + 1))}
              disabled={monthIdx === MONTHS.length - 1}
              className="p-2 rounded-xl bg-gray-800/60 border border-gray-700/40 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            <Stat label="Invoiced" value={fmt$(invoiced)} sub={`${payments.length} items`} />
            <Stat label="Received" value={fmt$(received)} sub={`${pctReceived}%`} color="text-emerald-400" />
            <Stat label="Outstanding" value={fmt$(outstanding)} sub="pending" color={outstanding > 0 ? 'text-amber-400' : 'text-gray-400'} />
          </div>

          {/* Add button */}
          <button
            onClick={() => setEditEntry(false)}
            className="w-full flex items-center justify-center gap-2 py-2.5 mb-4 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-300 text-sm font-semibold hover:bg-blue-600/30 transition-colors"
          >
            <Plus size={15} /> Add Entry
          </button>

          {/* Table */}
          {loadingPayments ? (
            <div className="flex justify-center py-12"><Spinner size="lg" /></div>
          ) : payments.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-800/60 flex items-center justify-center">
                <DollarSign size={24} className="text-gray-600" />
              </div>
              <p className="text-gray-500 text-sm">No entries for this month.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <motion.div
                  key={p.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`border rounded-xl p-3 transition-colors ${
                    p.status === 'RECEIVED'
                      ? 'bg-emerald-950/20 border-emerald-700/30'
                      : 'bg-gray-800/40 border-gray-700/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-gray-100 capitalize">{p.lastName}</span>
                        {p.status === 'RECEIVED' ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300">
                            <CheckCircle2 size={8} /> Received
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400">
                            <Clock size={8} /> Pending
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        {p.date && <span className="text-[11px] text-gray-500">{fmtDate(p.date)}</span>}
                        {p.bmwNumber && <span className="text-[11px] text-gray-500 font-mono">{p.bmwNumber}</span>}
                        {p.roNumber && <span className="text-[11px] text-blue-400 font-mono">RO {p.roNumber}</span>}
                      </div>
                      {p.notes && <p className="text-[11px] text-gray-600 mt-1 italic">{p.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-base font-black text-gray-100 tabular-nums">{fmt$(p.amount)}</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditEntry(p)}
                          className="p-1.5 rounded-lg text-gray-600 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                        {deleteId === p.id ? (
                          <div className="flex gap-1">
                            <button onClick={() => deleteMutation.mutate(p.id)}
                              className="px-2 py-1 text-[10px] font-bold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors">
                              Del
                            </button>
                            <button onClick={() => setDeleteId(null)}
                              className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg transition-colors">
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteId(p.id)}
                            className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Status toggle */}
                  <button
                    onClick={() => bmwApi.update(pin, p.id, { status: p.status === 'RECEIVED' ? 'NOT_RECEIVED' : 'RECEIVED' })
                      .then(() => queryClient.invalidateQueries({ queryKey: ['bmw-payments'] }))
                      .then(() => queryClient.invalidateQueries({ queryKey: ['bmw-summary'] }))
                    }
                    className={`mt-2 w-full py-1.5 rounded-lg text-[11px] font-semibold transition-colors border ${
                      p.status === 'RECEIVED'
                        ? 'border-emerald-700/40 text-emerald-500 hover:bg-red-500/5 hover:text-red-400 hover:border-red-500/30'
                        : 'border-gray-700/40 text-gray-500 hover:bg-emerald-500/5 hover:text-emerald-400 hover:border-emerald-500/30'
                    }`}
                  >
                    {p.status === 'RECEIVED' ? '✓ Mark as Pending' : 'Mark as Received'}
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── COMPARE TAB ── */}
      {activeTab === 'compare' && (
        <div>
          {loadingSummary ? (
            <div className="flex justify-center py-12"><Spinner size="lg" /></div>
          ) : (
            <>
              {/* All-time summary table */}
              <div className="bg-gray-800/50 border border-gray-700/40 rounded-2xl overflow-hidden mb-4">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700/40">
                  <BarChart3 size={14} className="text-blue-400" />
                  <h3 className="text-sm font-bold text-gray-200">All Months</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-700/40">
                        <th className="text-left px-3 py-2 text-gray-500 font-semibold">Month</th>
                        <th className="text-right px-3 py-2 text-gray-500 font-semibold">Inv.</th>
                        <th className="text-right px-3 py-2 text-gray-500 font-semibold">Rec.</th>
                        <th className="text-right px-3 py-2 text-gray-500 font-semibold">Out.</th>
                        <th className="text-right px-3 py-2 text-gray-500 font-semibold">#</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...summary]
                        .sort((a,b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
                        .map(s => (
                        <tr key={`${s.year}-${s.month}`} className="border-b border-gray-700/20 hover:bg-gray-700/20 transition-colors">
                          <td className="px-3 py-2 text-gray-300 font-medium">{MONTH_NAMES[s.month-1]} {s.year}</td>
                          <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{fmt$(s.invoiced)}</td>
                          <td className="px-3 py-2 text-right text-emerald-400 tabular-nums">{fmt$(s.received)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-semibold ${s.outstanding > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                            {fmt$(s.outstanding)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-500">{s.count}</td>
                        </tr>
                      ))}
                      {/* Totals row */}
                      {summary.length > 0 && (() => {
                        const tot = summary.reduce((acc, s) => ({
                          invoiced: acc.invoiced + parseFloat(s.invoiced),
                          received: acc.received + parseFloat(s.received),
                          outstanding: acc.outstanding + parseFloat(s.outstanding),
                          count: acc.count + s.count,
                        }), { invoiced:0, received:0, outstanding:0, count:0 })
                        return (
                          <tr className="border-t-2 border-gray-600/60 bg-gray-700/20">
                            <td className="px-3 py-2 text-gray-200 font-black text-xs uppercase">Total</td>
                            <td className="px-3 py-2 text-right text-gray-200 font-black tabular-nums">{fmt$(tot.invoiced)}</td>
                            <td className="px-3 py-2 text-right text-emerald-300 font-black tabular-nums">{fmt$(tot.received)}</td>
                            <td className="px-3 py-2 text-right text-amber-300 font-black tabular-nums">{fmt$(tot.outstanding)}</td>
                            <td className="px-3 py-2 text-right text-gray-400 font-black">{tot.count}</td>
                          </tr>
                        )
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              <ComparePanel summary={summary} />
            </>
          )}
        </div>
      )}

      {/* ── FILES TAB ── */}
      {activeTab === 'files' && (
        <div>
          {/* Upload area */}
          <div className="mb-5 bg-gray-800/50 border border-gray-700/50 rounded-2xl p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Add File</p>
            <input type="text" value={caption} onChange={e => setCaption(e.target.value)}
              placeholder="Caption / note (optional)"
              className="w-full bg-gray-900/60 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 mb-3" />
            <div className="flex gap-2">
              <button onClick={() => { fileInputRef.current?.removeAttribute('capture'); fileInputRef.current?.click() }}
                disabled={uploading}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-700/80 hover:bg-gray-600/80 disabled:opacity-40 text-sm font-medium text-gray-200 transition-colors">
                <Upload size={15} /> File
              </button>
              <button onClick={() => { fileInputRef.current?.setAttribute('capture', 'environment'); fileInputRef.current?.click() }}
                disabled={uploading}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-700/80 hover:bg-gray-600/80 disabled:opacity-40 text-sm font-medium text-gray-200 transition-colors">
                <Camera size={15} /> Camera
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
              onChange={handleFileChange} className="hidden" />
            {uploading && (
              <div className="flex items-center justify-center gap-2 mt-3 text-xs text-gray-400">
                <Spinner size="sm" /> Uploading…
              </div>
            )}
            {uploadError && <p className="text-xs text-red-400 mt-2 text-center">{uploadError}</p>}
          </div>

          {loadingFiles ? (
            <div className="flex justify-center py-12"><Spinner size="lg" /></div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-800/60 flex items-center justify-center">
                <Image size={24} className="text-gray-600" />
              </div>
              <p className="text-gray-500 text-sm">No files yet.</p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              <div className="grid grid-cols-2 gap-3">
                {files.map(file => (
                  <PrivateFileCard key={file.id} file={file} pin={pin}
                    onDelete={id => deleteFileMutation.mutate(id)} />
                ))}
              </div>
            </AnimatePresence>
          )}
        </div>
      )}

      {/* ── Entry Modal ── */}
      <AnimatePresence>
        {editEntry !== null && (
          <EntryModal
            entry={editEntry || null}
            month={month}
            year={year}
            pin={pin}
            onClose={() => setEditEntry(null)}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ['bmw-payments'] })
              queryClient.invalidateQueries({ queryKey: ['bmw-summary'] })
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
