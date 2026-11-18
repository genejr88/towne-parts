import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Check, Truck, PackageCheck, X, ExternalLink, Loader2, Tv, Pencil, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { atfApi, partsApi, techniciansApi } from '@/lib/api'
import Spinner from '@/components/ui/Spinner'

// After-the-fact part orders. Techs come to Gene; he enters RO + part + who asked, orders it,
// and marks it here. The same list shows on the shop TV screen (/atf-display, pages/AtfDisplay.jsx).
const STATUS = {
  NOT_ORDERED: { label: 'Not ordered', cls: 'bg-red-500/15 text-red-300 border-red-500/40' },
  ORDERED:     { label: 'Ordered · not here', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  HERE:        { label: 'Here', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
}
const SECTIONS = [
  ['NOT_ORDERED', 'Needs ordering'],
  ['ORDERED', 'Ordered, waiting on it'],
  ['HERE', 'Arrived today'],
]
const when = (d) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const field = 'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500/60'

export default function Atf() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const blank = { roNumber: '', description: '', partNumber: '', qty: '1', tech: '', otherTech: '', ordered: true }
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const { data: items = [], isLoading } = useQuery({ queryKey: ['atf'], queryFn: atfApi.list, refetchInterval: 30_000 })
  const { data: techs = [] } = useQuery({ queryKey: ['technicians'], queryFn: () => techniciansApi.list() })
  const activeTechs = techs.filter((t) => t.isActive !== false)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['atf'] })
    qc.invalidateQueries({ queryKey: ['still-out'] })
  }

  const create = useMutation({
    mutationFn: () => atfApi.create({
      roNumber: form.roNumber.trim(), description: form.description.trim(), partNumber: form.partNumber.trim(),
      qty: form.qty, tech: form.tech === '__other' ? form.otherTech.trim() : form.tech, ordered: form.ordered,
    }),
    onSuccess: () => {
      toast.success('Request added — it’s on the TV screen')
      setForm((f) => ({ ...blank, ordered: f.ordered })) // keep the ordered switch where Gene left it
      refresh()
    },
    onError: (err) => toast.error(err.response?.data?.error || err.message),
  })

  const update = useMutation({
    mutationFn: ({ id, data }) => partsApi.update(id, data),
    onSuccess: refresh,
    onError: (err) => toast.error(err.response?.data?.error || err.message),
  })

  const submit = (e) => {
    e.preventDefault()
    if (!form.roNumber.trim()) return toast.error('Enter the RO number')
    if (!form.description.trim()) return toast.error('Enter the part')
    if (!form.tech || (form.tech === '__other' && !form.otherTech.trim())) return toast.error('Pick the tech who asked')
    create.mutate()
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 pb-28 space-y-5">
      <div className="flex items-start gap-3">
        <ClipboardList size={20} className="text-amber-400 mt-0.5" />
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-100">After-the-fact orders</h1>
          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5"><Tv size={12} /> Everything open here shows on the shop TV screen, plus whatever arrived today.</p>
        </div>
      </div>

      {/* Quick add */}
      <form onSubmit={submit} className="rounded-2xl border border-gray-800 bg-gray-950 p-4 space-y-3">
        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
          <input value={form.roNumber} onChange={set('roNumber')} placeholder="RO #" inputMode="numeric" className={field + ' font-mono'} />
          <input value={form.description} onChange={set('description')} placeholder="Part (e.g. LT fog lamp bracket)" className={field} />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2">
          <input value={form.partNumber} onChange={set('partNumber')} placeholder="Part # (optional)" className={field + ' font-mono'} />
          <input value={form.qty} onChange={set('qty')} placeholder="Qty" inputMode="numeric" className={field} />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-stretch">
          <select value={form.tech} onChange={set('tech')} className={field}>
            <option value="">Tech who asked…</option>
            {activeTechs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            <option value="__other">Someone else…</option>
          </select>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, ordered: !f.ordered }))}
            className={`px-3 rounded-lg border text-xs font-semibold whitespace-nowrap ${form.ordered ? STATUS.ORDERED.cls : STATUS.NOT_ORDERED.cls}`}
            title="Tap to switch"
          >
            {form.ordered ? 'Already ordered' : 'Not ordered yet'}
          </button>
        </div>
        {form.tech === '__other' && <input value={form.otherTech} onChange={set('otherTech')} placeholder="Name" className={field} />}
        <button type="submit" disabled={create.isPending} className="w-full py-3 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 flex items-center justify-center gap-2">
          {create.isPending && <Loader2 size={15} className="animate-spin" />} Add request
        </button>
      </form>

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : !items.length ? (
        <p className="text-center text-sm text-gray-500 py-10">No after-the-fact orders open.</p>
      ) : SECTIONS.map(([key, title]) => {
        const rows = items.filter((i) => i.status === key)
        if (!rows.length) return null
        return (
          <section key={key}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">{title} · {rows.length}</p>
            <div className="rounded-xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
              {rows.map((r) => editingId === r.id ? (
                <EditRow key={r.id} row={r} techs={activeTechs} onDone={() => { setEditingId(null); refresh() }} onCancel={() => setEditingId(null)} />
              ) : (
                <div key={r.id} className="bg-gray-950 px-3.5 py-3 flex items-center gap-3">
                  <div className="w-14 shrink-0">
                    <p className="text-sm font-bold font-mono text-gray-100">{r.roNumber}</p>
                    <p className="text-[10px] text-gray-600 truncate">{r.vehicle.split(' ').slice(1).join(' ')}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-100 truncate">{r.part}{r.qty > 1 ? <span className="text-gray-500"> ×{r.qty}</span> : null}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {r.tech} · asked {when(r.requestedAt)}{r.status === 'HERE' ? ` · here ${when(r.receivedAt)}` : ''}{r.chaseStatus === 'BACKORDERED' ? ' · backordered' : ''}
                    </p>
                  </div>
                  <span className={`hidden sm:inline-block shrink-0 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {r.status === 'NOT_ORDERED' && (
                      <button onClick={() => update.mutate({ id: r.id, data: { chaseStatus: 'ORDERED' } })} className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-semibold flex items-center gap-1" title="Mark ordered">
                        <Truck size={13} /> Ordered
                      </button>
                    )}
                    {r.status === 'ORDERED' && (
                      <button onClick={() => update.mutate({ id: r.id, data: { isReceived: true } })} className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-1" title="Mark here">
                        <PackageCheck size={13} /> Here
                      </button>
                    )}
                    {r.status === 'HERE' && <Check size={16} className="text-emerald-400 mx-2" />}
                    {r.status !== 'HERE' && (
                      <button
                        onClick={() => { if (window.confirm(`Take "${r.part}" off the list as not needed?`)) update.mutate({ id: r.id, data: { chaseStatus: 'NOT_NEEDED' } }) }}
                        className="p-1.5 rounded-lg text-gray-600 hover:text-red-400" title="Not needed"
                      >
                        <X size={15} />
                      </button>
                    )}
                    <button onClick={() => setEditingId(r.id)} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200" title="Edit">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => navigate(`/ros/${r.roId}`)} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200" title={`Open RO ${r.roNumber}`}>
                      <ExternalLink size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// Fix a request entered wrong: RO (moves the part to that RO), part, part #, qty, who asked.
// Delete is for entries that never should have existed; "Not needed" (the ×) keeps the history.
function EditRow({ row, techs, onDone, onCancel }) {
  const known = techs.some((t) => t.name === row.tech)
  const [f, setF] = useState({
    roNumber: row.roNumber, description: row.part, partNumber: row.partNumber || '', qty: String(row.qty || 1),
    tech: known ? row.tech : '__other', otherTech: known ? '' : (row.tech || ''), status: row.status,
  })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: async () => {
      await atfApi.update(row.id, {
        roNumber: f.roNumber.trim(), description: f.description.trim(), partNumber: f.partNumber.trim(), qty: f.qty,
        tech: f.tech === '__other' ? f.otherTech.trim() : f.tech,
      })
      // Status fix (e.g. hit "Here" by mistake): undo receiving and/or step back to not ordered
      if (f.status !== row.status) {
        const patch = f.status === 'HERE' ? { isReceived: true }
          : f.status === 'ORDERED' ? { isReceived: false, ...(row.status === 'NOT_ORDERED' ? { chaseStatus: 'ORDERED' } : {}) }
          : { isReceived: false, chaseStatus: 'NEED_TO_ORDER', dateOrdered: null }
        await partsApi.update(row.id, patch)
      }
    },
    onSuccess: () => { toast.success('Saved'); onDone() },
    onError: (err) => toast.error(err.response?.data?.error || err.message),
  })
  const del = useMutation({
    mutationFn: () => atfApi.remove(row.id),
    onSuccess: () => { toast.success('Deleted'); onDone() },
    onError: (err) => toast.error(err.response?.data?.error || err.message),
  })
  const submit = (e) => {
    e.preventDefault()
    if (!f.roNumber.trim()) return toast.error('Enter the RO number')
    if (!f.description.trim()) return toast.error('Enter the part')
    if (f.tech === '__other' ? !f.otherTech.trim() : !f.tech) return toast.error('Pick the tech who asked')
    save.mutate()
  }
  return (
    <form onSubmit={submit} className="bg-gray-900 px-3.5 py-3 space-y-2">
      <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
        <input value={f.roNumber} onChange={set('roNumber')} placeholder="RO #" inputMode="numeric" className={field + ' font-mono'} />
        <input value={f.description} onChange={set('description')} placeholder="Part" className={field} autoFocus />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_70px] gap-2">
        <input value={f.partNumber} onChange={set('partNumber')} placeholder="Part # (optional)" className={field + ' font-mono'} />
        <input value={f.qty} onChange={set('qty')} placeholder="Qty" inputMode="numeric" className={field} />
      </div>
      <select value={f.tech} onChange={set('tech')} className={field}>
        <option value="">Tech who asked…</option>
        {techs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
        <option value="__other">Someone else…</option>
      </select>
      {f.tech === '__other' && <input value={f.otherTech} onChange={set('otherTech')} placeholder="Name" className={field} />}
      <div className="grid grid-cols-3 gap-1.5">
        {Object.entries(STATUS).map(([k, s]) => (
          <button
            key={k} type="button" onClick={() => setF((x) => ({ ...x, status: k }))}
            className={`py-2 rounded-lg border text-xs font-semibold ${f.status === k ? s.cls + ' ring-1 ring-current' : 'border-gray-700 text-gray-500 hover:text-gray-300'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => { if (window.confirm(`Delete "${row.part}" on RO ${row.roNumber}? Use this only if it was entered by mistake — for a part that isn't needed any more, use the × instead.`)) del.mutate() }}
          disabled={del.isPending}
          className="p-2 rounded-lg text-gray-500 hover:text-red-400 disabled:opacity-50" title="Delete (entered by mistake)"
        >
          <Trash2 size={15} />
        </button>
        <div className="flex-1" />
        <button type="button" onClick={onCancel} className="px-3.5 py-2 rounded-lg text-sm font-semibold text-gray-400 hover:text-gray-200">Cancel</button>
        <button type="submit" disabled={save.isPending} className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 flex items-center gap-1.5">
          {save.isPending && <Loader2 size={14} className="animate-spin" />} Save
        </button>
      </div>
    </form>
  )
}
