import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FilePlus, FileCheck, Clock, ChevronRight, X, Trash2, Check,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supplementsApi } from '@/lib/api'
import Spinner from '@/components/ui/Spinner'

const STATUS_FILTERS = [
  { key: null,          label: 'All' },
  { key: 'REQUESTED',  label: 'Requested' },
  { key: 'FILED',      label: 'Filed' },
]

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function Supplements() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState(null)  // null = all
  const [deleteId, setDeleteId] = useState(null)

  const { data: supplements = [], isLoading } = useQuery({
    queryKey: ['supplements-all', filter],
    queryFn: () => supplementsApi.listAll(filter),
    refetchInterval: 30_000,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => supplementsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplements-all'] })
      queryClient.invalidateQueries({ queryKey: ['production'] })
    },
    onError: (err) => toast.error(err.message || 'Failed to update'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => supplementsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplements-all'] })
      queryClient.invalidateQueries({ queryKey: ['production'] })
      setDeleteId(null)
      toast.success('Supplement removed')
    },
    onError: (err) => toast.error(err.message || 'Failed to delete'),
  })

  const handleStatusToggle = (s) => {
    const next = s.status === 'REQUESTED' ? 'FILED' : 'REQUESTED'
    updateMutation.mutate({ id: s.id, data: { status: next } })
    toast.success(next === 'FILED' ? 'Marked as Filed' : 'Marked as Requested')
  }

  // Group by RO
  const grouped = supplements.reduce((acc, s) => {
    const key = s.ro?.roNumber || 'Unknown'
    if (!acc[key]) acc[key] = { ro: s.ro, items: [] }
    acc[key].items.push(s)
    return acc
  }, {})

  const requestedCount = supplements.filter(s => s.status === 'REQUESTED').length
  const filedCount     = supplements.filter(s => s.status === 'FILED').length

  return (
    <div className="px-4 py-5 pb-28 max-w-2xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
        <h1 className="text-xl font-black text-gray-100 tracking-tight">Supplements</h1>
        <div className="flex items-center gap-3 mt-1">
          {requestedCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-400 font-semibold">
              <Clock size={12} /> {requestedCount} requested
            </span>
          )}
          {filedCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-emerald-400 font-semibold">
              <FileCheck size={12} /> {filedCount} filed
            </span>
          )}
        </div>
      </motion.div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-5">
        {STATUS_FILTERS.map(({ key, label }) => (
          <button
            key={String(key)}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              filter === key
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : supplements.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-800/60 flex items-center justify-center">
            <FilePlus size={26} className="text-gray-600" />
          </div>
          <p className="text-gray-500 text-sm">No supplements{filter ? ` with status "${filter.toLowerCase()}"` : ''} yet.</p>
          <p className="text-gray-600 text-xs">Use the Request button on the Production Board to log supplements.</p>
        </motion.div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([roNumber, { ro, items }]) => (
            <motion.div
              key={roNumber}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gray-800/50 border border-gray-700/40 rounded-2xl overflow-hidden"
            >
              {/* RO header row */}
              <button
                onClick={() => ro?.id && navigate(`/ros/${ro.id}`)}
                className="w-full flex items-center justify-between px-4 py-3 border-b border-gray-700/40 hover:bg-gray-700/30 transition-colors group"
              >
                <div className="text-left min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-gray-100 font-mono">RO #{roNumber}</span>
                    <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">
                      {items.length} supplement{items.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex gap-2 flex-wrap mt-0.5">
                    {ro?.insuranceCompany && (
                      <span className="text-xs text-gray-500">{ro.insuranceCompany}</span>
                    )}
                    {ro?.ownerName && (
                      <span className="text-xs text-gray-600">{ro.ownerName}</span>
                    )}
                  </div>
                </div>
                <ChevronRight size={14} className="text-gray-600 group-hover:text-gray-400 transition-colors shrink-0" />
              </button>

              {/* Supplement entries */}
              <div className="divide-y divide-gray-700/30">
                {items.map((s) => {
                  const isFiled = s.status === 'FILED'
                  return (
                    <AnimatePresence key={s.id} mode="wait">
                      <motion.div
                        layout
                        className="px-4 py-3 flex items-center gap-3"
                      >
                        {/* Status icon */}
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                          isFiled
                            ? 'bg-emerald-500/15 border border-emerald-500/30'
                            : 'bg-amber-500/15 border border-amber-500/30'
                        }`}>
                          {isFiled
                            ? <FileCheck size={15} className="text-emerald-400" />
                            : <FilePlus size={15} className="text-amber-400" />
                          }
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-gray-200">
                              Supplement {s.number}
                            </span>
                            <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
                              isFiled
                                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                                : 'bg-amber-500/10 border-amber-500/25 text-amber-400'
                            }`}>
                              {isFiled ? 'Filed' : 'Requested'}
                            </span>
                          </div>
                          {s.notes && (
                            <p className="text-xs text-gray-500 italic mt-0.5 truncate">{s.notes}</p>
                          )}
                          <p className="text-[10px] text-gray-700 mt-0.5">{fmtDate(s.createdAt)}</p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Status toggle */}
                          <button
                            onClick={() => handleStatusToggle(s)}
                            disabled={updateMutation.isPending}
                            title={isFiled ? 'Mark as Requested' : 'Mark as Filed'}
                            className={`p-2 rounded-xl border transition-colors ${
                              isFiled
                                ? 'border-emerald-700/40 text-emerald-500 hover:bg-amber-500/5 hover:text-amber-400 hover:border-amber-500/30'
                                : 'border-gray-700/40 text-gray-500 hover:bg-emerald-500/5 hover:text-emerald-400 hover:border-emerald-500/30'
                            }`}
                          >
                            {isFiled ? <Clock size={13} /> : <Check size={13} />}
                          </button>

                          {/* Delete */}
                          {deleteId === s.id ? (
                            <div className="flex gap-1">
                              <button
                                onClick={() => deleteMutation.mutate(s.id)}
                                disabled={deleteMutation.isPending}
                                className="px-2.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold transition-colors"
                              >
                                {deleteMutation.isPending ? '…' : 'Del'}
                              </button>
                              <button
                                onClick={() => setDeleteId(null)}
                                className="p-1.5 rounded-xl text-gray-600 hover:text-gray-400 transition-colors"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteId(s.id)}
                              className="p-2 rounded-xl text-gray-700 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    </AnimatePresence>
                  )
                })}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
