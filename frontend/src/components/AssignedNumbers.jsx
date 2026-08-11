import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, Hash, Car } from 'lucide-react'
import { numbersApi } from '@/lib/api'
import Spinner from '@/components/ui/Spinner'

// Add a new program here (+ a matching NumberSequence row seeded in the backend)
// to add another manufacturer's sequence — e.g. Genesis of Milford → GM#.
const PROGRAMS = {
  BMW: { key: 'BMW', label: 'BMW', numberLabel: 'M#' },
  GENESIS_FAIRFIELD: { key: 'GENESIS_FAIRFIELD', label: 'Genesis of Fairfield', numberLabel: 'GF#' },
}
const PROGRAM_LIST = Object.values(PROGRAMS)

function Field({ label, value, onChange, placeholder, mono }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  )
}

function EntryModal({ entry, programCfg, pin, onClose, onSaved }) {
  const [form, setForm] = useState({
    number:          entry?.number          || '',
    programRoNumber: entry?.programRoNumber || '',
    towneRoNumber:   entry?.towneRoNumber   || '',
    vehicleYear:     entry?.vehicleYear     || '',
    vehicleMake:     entry?.vehicleMake     || (programCfg.key === 'BMW' ? 'BMW' : ''),
    vehicleModel:    entry?.vehicleModel    || '',
    customerName:    entry?.customerName    || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.number.trim()) { setErr(`${programCfg.numberLabel} is required`); return }
    setSaving(true)
    setErr('')
    try {
      await numbersApi.update(pin, entry.id, {
        number:          form.number.trim(),
        programRoNumber: form.programRoNumber.trim() || null,
        towneRoNumber:   form.towneRoNumber.trim()   || null,
        vehicleYear:     form.vehicleYear.trim()     || null,
        vehicleMake:     form.vehicleMake.trim()     || null,
        vehicleModel:    form.vehicleModel.trim()    || null,
        customerName:    form.customerName.trim()    || null,
      })
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
          <h3 className="text-base font-bold text-gray-100">Edit {programCfg.label} Number</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-700/50">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <Field label={programCfg.numberLabel} value={form.number} onChange={v => set('number', v)} mono />
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${programCfg.label} RO#`} value={form.programRoNumber} onChange={v => set('programRoNumber', v)} mono />
            <Field label="Towne RO#" value={form.towneRoNumber} onChange={v => set('towneRoNumber', v)} mono />
          </div>
          <Field label="Customer Name" value={form.customerName} onChange={v => set('customerName', v)} placeholder="Kornutik" />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Year" value={form.vehicleYear} onChange={v => set('vehicleYear', v)} placeholder="24" />
            <Field label="Make" value={form.vehicleMake} onChange={v => set('vehicleMake', v)} placeholder="BMW" />
            <Field label="Model" value={form.vehicleModel} onChange={v => set('vehicleModel', v)} placeholder="i7" />
          </div>
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
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

export default function AssignedNumbers({ pin }) {
  const queryClient = useQueryClient()
  const [programKey, setProgramKey] = useState(() => localStorage.getItem('numbers_program') || 'BMW')
  const programCfg = PROGRAMS[programKey] || PROGRAMS.BMW
  const changeProgram = (key) => {
    setProgramKey(key)
    localStorage.setItem('numbers_program', key)
  }

  const [editEntry, setEditEntry] = useState(null) // null = closed, obj = editing
  const [deleteId, setDeleteId]   = useState(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError]     = useState('')

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['assigned-numbers', programKey],
    queryFn: () => numbersApi.list(pin, programKey),
    enabled: !!pin,
  })

  const { data: preview } = useQuery({
    queryKey: ['assigned-numbers-preview', programKey],
    queryFn: () => numbersApi.nextPreview(pin, programKey),
    enabled: !!pin,
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => numbersApi.remove(pin, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assigned-numbers', programKey] })
      setDeleteId(null)
    },
  })

  const handleGenerate = async () => {
    setGenerating(true)
    setGenError('')
    try {
      const record = await numbersApi.generateNext(pin, programKey)
      queryClient.invalidateQueries({ queryKey: ['assigned-numbers', programKey] })
      queryClient.invalidateQueries({ queryKey: ['assigned-numbers-preview', programKey] })
      setEditEntry(record) // open it immediately so details can be filled in
    } catch (e) {
      setGenError(e.message || 'Failed to generate number')
    }
    setGenerating(false)
  }

  return (
    <div>
      {/* Program switcher */}
      <div className="flex gap-1 mb-5 bg-gray-800/50 border border-gray-700/40 rounded-xl p-1">
        {PROGRAM_LIST.map((p) => (
          <button key={p.key} onClick={() => changeProgram(p.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              programKey === p.key
                ? 'bg-gray-700 text-white shadow'
                : 'text-gray-500 hover:text-gray-300'
            }`}>
            <Car size={12} /> {p.label}
          </button>
        ))}
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={generating}
        className="w-full flex items-center justify-center gap-2 py-3 mb-2 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-300 text-sm font-semibold hover:bg-blue-600/30 disabled:opacity-50 transition-colors"
      >
        <Plus size={15} /> {generating ? 'Generating…' : `Generate Next${preview?.preview ? ` (${preview.preview})` : ''}`}
      </button>
      {genError && <p className="text-xs text-red-400 mb-3 text-center">{genError}</p>}

      <p className="text-[11px] text-gray-600 mb-4 text-center">{records.length} {programCfg.label} number{records.length === 1 ? '' : 's'} issued</p>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gray-800/60 flex items-center justify-center">
            <Hash size={24} className="text-gray-600" />
          </div>
          <p className="text-gray-500 text-sm">No numbers issued yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((r) => (
            <motion.div
              key={r.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="border rounded-xl p-3 bg-gray-800/40 border-gray-700/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-blue-300 font-mono">{r.number}</span>
                    {r.customerName && <span className="text-sm font-bold text-gray-100">{r.customerName}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    {(r.vehicleYear || r.vehicleMake || r.vehicleModel) && (
                      <span className="text-[11px] text-gray-500">
                        {[r.vehicleYear, r.vehicleMake, r.vehicleModel].filter(Boolean).join(' ')}
                      </span>
                    )}
                    {r.programRoNumber && <span className="text-[11px] text-gray-500 font-mono">RO {r.programRoNumber}</span>}
                    {r.towneRoNumber && <span className="text-[11px] text-blue-400 font-mono">Towne RO {r.towneRoNumber}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditEntry(r)}
                    className="p-1.5 rounded-lg text-gray-600 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                  >
                    <Pencil size={13} />
                  </button>
                  {deleteId === r.id ? (
                    <div className="flex gap-1">
                      <button onClick={() => deleteMutation.mutate(r.id)}
                        className="px-2 py-1 text-[10px] font-bold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors">
                        Del
                      </button>
                      <button onClick={() => setDeleteId(null)}
                        className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg transition-colors">
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteId(r.id)}
                      className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Entry Modal */}
      <AnimatePresence>
        {editEntry !== null && (
          <EntryModal
            entry={editEntry}
            programCfg={programCfg}
            pin={pin}
            onClose={() => setEditEntry(null)}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ['assigned-numbers', programKey] })}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
