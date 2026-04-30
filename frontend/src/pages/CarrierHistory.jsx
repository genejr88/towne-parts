import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Check, X, ExternalLink, BookOpen } from 'lucide-react'
import toast from 'react-hot-toast'
import { carriersApi } from '@/lib/api'
import Spinner from '@/components/ui/Spinner'

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const METHOD_COLORS = {
  EMAIL:  'bg-blue-500/10 border-blue-500/25 text-blue-400',
  PORTAL: 'bg-purple-500/10 border-purple-500/25 text-purple-400',
  FAX:    'bg-amber-500/10 border-amber-500/25 text-amber-400',
  PHONE:  'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
  MAIL:   'bg-gray-500/10 border-gray-500/25 text-gray-400',
}

// ── Inline editable field ─────────────────────────────────────────────────────
function EditableField({ label, value, onSave, type = 'text', placeholder = '' }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value || '')

  const commit = () => {
    onSave(draft.trim() || null)
    setEditing(false)
  }
  const cancel = () => {
    setDraft(value || '')
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{label}</span>
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            type={type}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
            placeholder={placeholder}
            className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-2.5 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          />
          <button onClick={commit} className="p-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white">
            <Check size={12} />
          </button>
          <button onClick={cancel} className="p-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300">
            <X size={12} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => { setDraft(value || ''); setEditing(true) }}
      className="flex flex-col gap-0.5 text-left group w-full"
    >
      <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{label}</span>
      <span className={`text-sm ${value ? 'text-gray-200' : 'text-gray-600 italic'} group-hover:text-blue-400 transition-colors`}>
        {value || placeholder || 'Click to edit'}
      </span>
    </button>
  )
}

// ── Carrier Card ──────────────────────────────────────────────────────────────
function CarrierCard({ carrier }) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)

  const { data: detail } = useQuery({
    queryKey: ['carrier-detail', carrier.id],
    queryFn:  () => carriersApi.get(carrier.id),
    enabled:  expanded,
  })

  const updateMutation = useMutation({
    mutationFn: (data) => carriersApi.update(carrier.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carriers'] })
      queryClient.invalidateQueries({ queryKey: ['carrier-detail', carrier.id] })
    },
    onError: (err) => toast.error(err.message || 'Failed to save'),
  })

  const methodColor = METHOD_COLORS[carrier.preferredMethod] || METHOD_COLORS.MAIL
  const logCount    = carrier._count?.filingLogs ?? 0
  const lastLog     = carrier.filingLogs?.[0]

  return (
    <div className="bg-gray-800/70 border border-gray-700/60 rounded-2xl overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start justify-between px-4 py-3.5 hover:bg-gray-700/40 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-gray-100">{carrier.name}</span>
            {carrier.preferredMethod && (
              <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${methodColor}`}>
                {carrier.preferredMethod}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-xs text-gray-500">{logCount} filing{logCount !== 1 ? 's' : ''}</span>
            {lastLog && (
              <span className="text-xs text-gray-600">Last: {fmtDate(lastLog.createdAt)}</span>
            )}
          </div>
        </div>
        {expanded ? <ChevronUp size={15} className="text-gray-400 mt-0.5 shrink-0" /> : <ChevronDown size={15} className="text-gray-400 mt-0.5 shrink-0" />}
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-700/50 px-4 py-4 space-y-4">
              {/* Contact grid */}
              <div className="grid grid-cols-2 gap-3">
                <EditableField
                  label="Contact Name"
                  value={carrier.contactName}
                  placeholder="Adjuster name"
                  onSave={v => updateMutation.mutate({ contactName: v })}
                />
                <EditableField
                  label="Email"
                  value={carrier.contactEmail}
                  placeholder="adjuster@carrier.com"
                  type="email"
                  onSave={v => updateMutation.mutate({ contactEmail: v })}
                />
                <EditableField
                  label="Phone"
                  value={carrier.contactPhone}
                  placeholder="203-555-0100"
                  onSave={v => updateMutation.mutate({ contactPhone: v })}
                />
                <EditableField
                  label="Fax"
                  value={carrier.contactFax}
                  placeholder="203-555-0100"
                  onSave={v => updateMutation.mutate({ contactFax: v })}
                />
              </div>

              {/* Portal URL */}
              <div className="flex flex-col gap-1">
                <EditableField
                  label="Portal URL"
                  value={carrier.portalUrl}
                  placeholder="https://..."
                  onSave={v => updateMutation.mutate({ portalUrl: v })}
                />
                {carrier.portalUrl && (
                  <a
                    href={carrier.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <ExternalLink size={11} /> Open Portal
                  </a>
                )}
              </div>

              {/* Preferred method */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Preferred Method</span>
                <div className="flex gap-1.5 flex-wrap">
                  {['EMAIL', 'PORTAL', 'FAX', 'PHONE', 'MAIL'].map(m => (
                    <button
                      key={m}
                      onClick={() => updateMutation.mutate({ preferredMethod: m })}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                        carrier.preferredMethod === m
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <EditableField
                label="Notes"
                value={carrier.notes}
                placeholder="Any filing notes or SOP details"
                onSave={v => updateMutation.mutate({ notes: v })}
              />

              {/* Filing history */}
              {detail?.filingLogs?.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Filing History</span>
                  <div className="space-y-1.5">
                    {detail.filingLogs.map(log => (
                      <div key={log.id} className="flex items-start gap-2.5 bg-gray-900/40 border border-gray-700/40 rounded-xl px-3 py-2.5">
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border shrink-0 mt-0.5 ${METHOD_COLORS[log.method] || METHOD_COLORS.MAIL}`}>
                          {log.method}
                        </span>
                        <div className="flex-1 min-w-0">
                          {log.supplement && (
                            <p className="text-xs font-semibold text-gray-300">
                              RO {log.supplement.ro?.roNumber} — Supp {log.supplement.number}
                              {log.supplement.ro?.ownerName && (
                                <span className="text-gray-500 font-normal"> · {log.supplement.ro.ownerName}</span>
                              )}
                            </p>
                          )}
                          {log.contactEmail  && <p className="text-[10px] text-gray-500 truncate">{log.contactEmail}</p>}
                          {log.portalUrl     && <p className="text-[10px] text-gray-500 truncate">{log.portalUrl}</p>}
                          {log.notes         && <p className="text-[10px] text-gray-600 italic">{log.notes}</p>}
                        </div>
                        <span className="text-[10px] text-gray-600 shrink-0">{fmtDate(log.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CarrierHistory() {
  const { data: carriers = [], isLoading } = useQuery({
    queryKey: ['carriers'],
    queryFn:  carriersApi.list,
  })

  return (
    <div className="px-4 py-5 pb-28 max-w-2xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
        <div className="flex items-center gap-2">
          <BookOpen size={18} className="text-blue-400" />
          <h1 className="text-xl font-black text-gray-100 tracking-tight">Carrier Filing History</h1>
        </div>
      </motion.div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : carriers.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-gray-500 text-sm">No billing history yet.</p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {carriers.map(carrier => (
            <motion.div
              key={carrier.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <CarrierCard carrier={carrier} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
