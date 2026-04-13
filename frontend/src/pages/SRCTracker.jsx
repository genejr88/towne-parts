import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { RotateCcw, Plus, Check, Trash2, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { srcApi, rosApi } from '@/lib/api'
import { formatDate, SRC_TYPES } from '@/lib/utils'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Select from '@/components/ui/Select'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'

const FILTER_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'completed', label: 'Done' },
  { key: 'all', label: 'All' },
]

function SRCCard({ entry, onComplete, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={`bg-gray-800/70 border rounded-xl overflow-hidden transition-colors ${
        entry.completed ? 'border-gray-700/30 opacity-60' : 'border-gray-700/60'
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Complete button */}
          {!entry.completed && (
            <button
              onClick={() => onComplete(entry.id)}
              className="mt-0.5 w-7 h-7 rounded-xl border-2 border-gray-600 bg-gray-800 flex items-center justify-center shrink-0 hover:border-emerald-500 active:bg-emerald-500/20 transition-colors"
            >
              <Check size={14} className="text-gray-600" />
            </button>
          )}
          {entry.completed && (
            <div className="mt-0.5 w-7 h-7 rounded-xl bg-emerald-600/20 border border-emerald-600/40 flex items-center justify-center shrink-0">
              <Check size={14} className="text-emerald-400" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge variant={entry.completed ? 'green' : 'orange'}>{entry.type}</Badge>
              {entry.ro?.roNumber && (
                <span className="text-xs font-mono font-semibold text-gray-300">
                  RO {entry.ro.roNumber}
                </span>
              )}
              {entry.partNumber && (
                <span className="text-xs text-gray-500 font-mono">{entry.partNumber}</span>
              )}
            </div>

            {entry.ro && (
              <p className="text-xs text-gray-500 mb-1">
                {[entry.ro.vehicleYear, entry.ro.vehicleMake, entry.ro.vehicleModel].filter(Boolean).join(' ')}
              </p>
            )}

            {entry.note && (
              <p className="text-sm text-gray-300 line-clamp-2">{entry.note}</p>
            )}

            <p className="text-xs text-gray-600 mt-2">{formatDate(entry.createdAt)}</p>
          </div>

          <button
            onClick={() => onDelete(entry.id)}
            className="p-1.5 text-gray-600 hover:text-red-400 active:text-red-500 transition-colors shrink-0"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function CreateSRCModal({ open, onClose }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ roId: '', type: 'Return', partNumber: '', note: '' })

  const { data: ros } = useQuery({
    queryKey: ['ros', { archived: false }],
    queryFn: () => rosApi.list({ archived: false }),
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: ({ roId, data }) => srcApi.create(roId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['src'] })
      toast.success('SRC entry created')
      setForm({ roId: '', type: 'Return', partNumber: '', note: '' })
      onClose()
    },
    onError: (err) => toast.error(err.message || 'Failed to create'),
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = () => {
    if (!form.roId) {
      toast.error('Please select a repair order')
      return
    }
    mutation.mutate({ roId: form.roId, data: { type: form.type, partNumber: form.partNumber, note: form.note } })
  }

  return (
    <Modal open={open} onClose={onClose} title="New S.R.C. Entry">
      <div className="space-y-4">
        <Select label="Repair Order *" value={form.roId} onChange={set('roId')}>
          <option value="">— Select RO —</option>
          {ros?.map((ro) => (
            <option key={ro.id} value={ro.id}>
              {ro.roNumber} — {[ro.vehicleYear, ro.vehicleMake, ro.vehicleModel].filter(Boolean).join(' ')}
            </option>
          ))}
        </Select>
        <Select label="Type" value={form.type} onChange={set('type')}>
          {SRC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Input label="Part Number" value={form.partNumber} onChange={set('partNumber')} placeholder="Optional" />
        <Textarea label="Note" value={form.note} onChange={set('note')} rows={3} placeholder="Details..." />
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={handleSubmit} className="flex-1">
            Create Entry
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default function SRCTracker() {
  const queryClient = useQueryClient()
  const [activeFilter, setActiveFilter] = useState('open')
  const [createOpen, setCreateOpen] = useState(false)

  const queryParams = activeFilter !== 'all' ? { status: activeFilter } : {}

  const { data: entries, isLoading } = useQuery({
    queryKey: ['src', queryParams],
    queryFn: () => srcApi.list(queryParams),
  })

  const completeMutation = useMutation({
    mutationFn: (id) => srcApi.update(id, { completed: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['src'] })
      toast.success('Marked complete')
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => srcApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['src'] })
      toast.success('Entry removed')
    },
    onError: (err) => toast.error(err.message),
  })

  const handleDelete = (id) => {
    if (window.confirm('Delete this SRC entry?')) {
      deleteMutation.mutate(id)
    }
  }

  // Group entries by RO
  const grouped = {}
  entries?.forEach((entry) => {
    const key = entry.ro?.roNumber || 'No RO'
    if (!grouped[key]) grouped[key] = { ro: entry.ro, entries: [] }
    grouped[key].entries.push(entry)
  })

  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs */}
      <div className="bg-gray-950/95 backdrop-blur-sm px-4 pt-3 pb-2 border-b border-gray-800/60 sticky top-0 z-10">
        <div className="flex gap-2">
          {FILTER_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveFilter(key)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 ${
                activeFilter === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {label}
              {entries && key === activeFilter && (
                <span className="ml-1 text-xs opacity-70">({entries.length})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-28">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : entries?.length === 0 ? (
          <EmptyState
            icon={RotateCcw}
            title={activeFilter === 'open' ? 'No open SRC entries' : 'No entries found'}
            description={activeFilter === 'open' ? 'All caught up!' : ''}
          />
        ) : (
          <AnimatePresence>
            {Object.entries(grouped).map(([roNum, group]) => (
              <div key={roNum} className="mb-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    RO {roNum}
                  </span>
                  {group.ro && (
                    <span className="text-xs text-gray-600">
                      {[group.ro.vehicleYear, group.ro.vehicleMake, group.ro.vehicleModel].filter(Boolean).join(' ')}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {group.entries.map((entry) => (
                    <SRCCard
                      key={entry.id}
                      entry={entry}
                      onComplete={completeMutation.mutate}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* FAB */}
      <motion.button
        whileTap={{ scale: 0.93 }}
        onClick={() => setCreateOpen(true)}
        className="fixed bottom-20 right-4 z-30 w-14 h-14 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-glow shadow-xl"
      >
        <Plus size={26} strokeWidth={2.5} />
      </motion.button>

      <CreateSRCModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
