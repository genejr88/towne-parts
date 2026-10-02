import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { partsApi } from '@/lib/api'
import { CHASE_STATUSES, fmtWhen, dateInput, fmtDay } from '@/lib/chase'

const EVENT_DOT = {
  ADDED: 'bg-gray-500', ORDERED: 'bg-blue-400', ETA: 'bg-sky-400', STATUS: 'bg-amber-400',
  NOTE: 'bg-gray-300', RECEIVED: 'bg-emerald-400', PARTIAL: 'bg-emerald-600', UNRECEIVED: 'bg-red-400',
}

// Follow-up panel for one part: status, ETA and a note in one save, plus the full timeline.
// roId is used to refresh the RO page after a change.
export default function PartFollowUp({ part, roId }) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [eta, setEta] = useState(dateInput(part.etaDate))
  const [status, setStatus] = useState(part.chaseStatus || 'ORDERED')

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['part-events', part.id],
    queryFn: () => partsApi.events(part.id),
  })

  const save = useMutation({
    mutationFn: () => {
      const body = {}
      if (note.trim()) body.note = note.trim()
      if (eta !== dateInput(part.etaDate)) body.etaDate = eta || null
      if (status !== (part.chaseStatus || 'ORDERED')) body.chaseStatus = status
      if (!Object.keys(body).length) throw new Error('Nothing changed')
      return partsApi.followUp(part.id, body)
    },
    onSuccess: (data) => {
      setNote('')
      queryClient.setQueryData(['part-events', part.id], data.events)
      queryClient.invalidateQueries({ queryKey: ['still-out'] })
      if (roId) queryClient.invalidateQueries({ queryKey: ['ro', String(roId)] })
      queryClient.invalidateQueries({ queryKey: ['ro', roId] })
      toast.success('Saved')
    },
    onError: (err) => toast.error(err.message),
  })

  const legacyNote = part.notes && !events.some((e) => e.type === 'NOTE') ? part.notes : null

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500/60"
          >
            {CHASE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">ETA</span>
          <input
            type="date"
            value={eta}
            onChange={(e) => setEta(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500/60 [color-scheme:dark]"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save.mutate() }}
          placeholder="Called dealer, backordered till Friday"
          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500/60"
        />
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 flex items-center gap-1.5"
        >
          {save.isPending && <Loader2 size={14} className="animate-spin" />}
          Save
        </button>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Timeline</p>
        {isLoading ? (
          <Loader2 size={14} className="animate-spin text-gray-500" />
        ) : (
          <ol className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="flex gap-2.5 text-xs">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${EVENT_DOT[e.type] || 'bg-gray-500'}`} />
                <div className="min-w-0">
                  <span className={e.type === 'NOTE' ? 'text-gray-100' : 'text-gray-300'}>{e.type === 'NOTE' ? `“${e.message}”` : e.message}</span>
                  <span className="text-gray-600"> · {fmtWhen(e.createdAt)}{e.username ? ` · ${e.username}` : ''}</span>
                </div>
              </li>
            ))}
            {legacyNote && (
              <li className="flex gap-2.5 text-xs">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 bg-gray-300" />
                <span className="text-gray-100">“{legacyNote}” <span className="text-gray-600">· earlier note</span></span>
              </li>
            )}
            <li className="flex gap-2.5 text-xs">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 bg-gray-600" />
              <span className="text-gray-500">
                On the RO since {fmtWhen(part.createdAt)}{part.dateOrdered ? ` · ordered ${fmtDay(part.dateOrdered)}` : ''}
              </span>
            </li>
          </ol>
        )}
      </div>
    </div>
  )
}
