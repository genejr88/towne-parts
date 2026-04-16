import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Edit2, Check, X, Plus, Trash2, Upload, FileText,
  Package, RotateCcw, Archive, ArchiveRestore, ChevronDown, ChevronUp,
  ExternalLink, Clock, Send, Camera, Loader2
} from 'lucide-react'
import toast from 'react-hot-toast'
import api, { rosApi, partsApi, invoicesApi, srcApi, vendorsApi, telegramApi } from '@/lib/api'
import { formatDate, formatCurrency, FINISH_STATUSES, nextFinishStatus, SRC_TYPES } from '@/lib/utils'
import PartsBadge from '@/components/ui/PartsBadge'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import Modal from '@/components/ui/Modal'
import Spinner from '@/components/ui/Spinner'

// ── Finish chip ────────────────────────────────────────────────────────────────
function FinishChip({ value, onClick }) {
  const finish = FINISH_STATUSES.find((f) => f.value === value) || FINISH_STATUSES[0]
  const colorMap = {
    blue: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    orange: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    gray: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  }
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${colorMap[finish.color] || colorMap.gray}`}
    >
      {finish.label}
    </button>
  )
}

// ── Edit RO Modal ──────────────────────────────────────────────────────────────
function EditROModal({ open, onClose, ro }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    roNumber: ro.roNumber,
    vehicleYear: ro.vehicleYear?.toString() || '',
    vehicleMake: ro.vehicleMake || '',
    vehicleModel: ro.vehicleModel || '',
    vin: ro.vin || '',
    color: ro.color || '',
    vendorId: ro.vendorId || '',
  })

  const { data: vendors } = useQuery({
    queryKey: ['vendors'],
    queryFn: vendorsApi.list,
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: (data) => rosApi.update(ro.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ro', ro.id] })
      toast.success('RO updated')
      onClose()
    },
    onError: (err) => toast.error(err.message || 'Failed to update'),
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <Modal open={open} onClose={onClose} title="Edit RO">
      <div className="space-y-4">
        <Input label="RO Number" value={form.roNumber} onChange={set('roNumber')} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Year" type="number" value={form.vehicleYear} onChange={set('vehicleYear')} placeholder="2024" />
          <Input label="Color" value={form.color} onChange={set('color')} placeholder="Silver" />
        </div>
        <Input label="Make" value={form.vehicleMake} onChange={set('vehicleMake')} />
        <Input label="Model" value={form.vehicleModel} onChange={set('vehicleModel')} />
        <Input label="VIN" value={form.vin} onChange={set('vin')} maxLength={17} />
        <Select label="Vendor" value={form.vendorId} onChange={set('vendorId')}>
          <option value="">— None —</option>
          {vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate({
            ...form,
            vehicleYear: form.vehicleYear ? parseInt(form.vehicleYear) : undefined,
            vendorId: form.vendorId || undefined,
          })} className="flex-1">Save</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Add Part Modal ─────────────────────────────────────────────────────────────
function AddPartModal({ open, onClose, roId }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    partNumber: '', description: '', qty: '1', price: '', eta: '', core: false,
  })

  const mutation = useMutation({
    mutationFn: (data) => partsApi.create(roId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ro', roId] })
      toast.success('Part added')
      setForm({ partNumber: '', description: '', qty: '1', price: '', eta: '', core: false })
      onClose()
    },
    onError: (err) => toast.error(err.message || 'Failed to add part'),
  })

  const set = (key) => (e) => setForm((f) => ({
    ...f,
    [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }))

  return (
    <Modal open={open} onClose={onClose} title="Add Part">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Part Number" value={form.partNumber} onChange={set('partNumber')} placeholder="ABC-123" />
          <Input label="Qty" type="number" value={form.qty} onChange={set('qty')} min="1" />
        </div>
        <Input label="Description" value={form.description} onChange={set('description')} placeholder="Front bumper" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Price ($)" type="number" value={form.price} onChange={set('price')} placeholder="0.00" step="0.01" />
          <Input label="ETA Date" type="date" value={form.eta} onChange={set('eta')} />
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.core} onChange={set('core')} className="w-5 h-5 rounded accent-blue-500" />
          <span className="text-sm text-gray-300">Has core charge</span>
        </label>
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate({
            ...form,
            qty: parseInt(form.qty) || 1,
            price: form.price ? Math.round(parseFloat(form.price) * 100) : undefined,
            eta: form.eta || undefined,
          })} className="flex-1">Add Part</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Add SRC Modal ──────────────────────────────────────────────────────────────
function AddSRCModal({ open, onClose, roId }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ entryType: 'RETURN', note: '' })

  const mutation = useMutation({
    mutationFn: (data) => srcApi.create(roId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ro', roId] })
      queryClient.invalidateQueries({ queryKey: ['src'] })
      toast.success('SRC entry added')
      setForm({ entryType: 'RETURN', note: '' })
      onClose()
    },
    onError: (err) => toast.error(err.message || 'Failed to add SRC'),
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <Modal open={open} onClose={onClose} title="Add S.R.C. Entry">
      <div className="space-y-4">
        <Select label="Type" value={form.entryType} onChange={set('entryType')}>
          <option value="RETURN">Return</option>
          <option value="CORE_RETURN">Core Return</option>
        </Select>
        <Textarea label="Note" value={form.note} onChange={set('note')} rows={3} placeholder="Details..." />
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate({ entryType: form.entryType, note: form.note })} className="flex-1">Add</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, children, action, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl overflow-hidden mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left"
      >
        <span className="text-sm font-semibold text-gray-200">{title}</span>
        <div className="flex items-center gap-2">
          {action && <div onClick={(e) => e.stopPropagation()}>{action}</div>}
          {open ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
        </div>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

// ── Authenticated image — fetches via API (with JWT) so it always works ──────
function AuthImage({ photoId, filename }) {
  const [blobUrl, setBlobUrl] = useState(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let url = null
    api.get(`/parts/photos/${photoId}/file`, { responseType: 'blob' })
      .then((res) => { url = URL.createObjectURL(res.data); setBlobUrl(url) })
      .catch(() => setErrored(true))
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [photoId])

  if (errored) return (
    <div className="w-16 h-16 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center shrink-0">
      <Camera size={12} className="text-gray-600" />
    </div>
  )
  if (!blobUrl) return (
    <div className="w-16 h-16 rounded-lg bg-gray-700/40 border border-gray-700 animate-pulse shrink-0" />
  )
  return (
    <a href={blobUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
      <img
        src={blobUrl}
        alt={filename || 'Part photo'}
        className="w-16 h-16 object-cover rounded-lg border border-gray-600 hover:border-blue-400 transition-colors"
      />
    </a>
  )
}

// ── Part row ──────────────────────────────────────────────────────────────────
function PartRow({ part, roId }) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)

  const updateMutation = useMutation({
    mutationFn: (data) => partsApi.update(part.id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ro', roId] }),
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => partsApi.remove(part.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ro', roId] })
      toast.success('Part removed')
    },
    onError: (err) => toast.error(err.message),
  })

  const photoMutation = useMutation({
    mutationFn: async (file) => {
      await partsApi.uploadPhoto(part.id, file)
      if (!part.isReceived) {
        await partsApi.update(part.id, { isReceived: true })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ro', roId] })
      toast.success('Photo saved — part marked received')
    },
    onError: (err) => toast.error(err.message),
  })

  const handlePhotoFile = (e) => {
    const file = e.target.files?.[0]
    if (file) photoMutation.mutate(file)
    e.target.value = ''
  }

  const toggle = (field) => updateMutation.mutate({ [field]: !part[field] })
  const cycleFinish = () => updateMutation.mutate({ finishStatus: nextFinishStatus(part.finishStatus || 'NO_FINISH_NEEDED') })

  return (
    <div className={`border border-gray-700/40 rounded-xl p-3.5 mb-2 transition-opacity ${part.isReceived ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-3">
        {/* Received checkbox */}
        <button
          onClick={() => toggle('isReceived')}
          className={`mt-0.5 w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${
            part.isReceived ? 'bg-emerald-600 border-emerald-600' : 'border-gray-600 bg-gray-800'
          }`}
        >
          {part.isReceived && <Check size={13} className="text-white" />}
        </button>

        {/* Part info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {part.partNumber && (
              <span className={`text-xs font-mono font-semibold ${part.isReceived ? 'line-through text-gray-600' : 'text-gray-300'}`}>
                {part.partNumber}
              </span>
            )}
            {part.qty > 1 && (
              <span className="text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded-md font-medium">
                ×{part.qty}
              </span>
            )}
            {part.hasCore && (
              <Badge variant="orange" className="text-[10px] py-0.5 px-2">Core</Badge>
            )}
          </div>
          <p className={`text-sm mt-0.5 ${part.isReceived ? 'line-through text-gray-600' : 'text-gray-200'}`}>
            {part.description || <span className="text-gray-600 italic">No description</span>}
          </p>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {part.etaDate && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Clock size={11} /> ETA {formatDate(part.etaDate)}
              </span>
            )}
            {part.price != null && (
              <span className="text-xs text-gray-500">{formatCurrency(part.price)}</span>
            )}
            <FinishChip value={part.finishStatus || 'NO_FINISH_NEEDED'} onClick={cycleFinish} />
          </div>
          {part.photos && part.photos.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
              {part.photos.map((photo) => (
                <AuthImage key={photo.id} photoId={photo.id} filename={photo.originalFilename} />
              ))}
            </div>
          )}
        </div>

        {/* Camera + Delete */}
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={photoMutation.isPending}
            className="p-1.5 text-gray-500 hover:text-blue-400 active:text-blue-500 transition-colors disabled:opacity-40"
            title="Add photo — marks part as received"
          >
            {photoMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
          </button>
          <button
            onClick={() => {
              if (window.confirm('Remove this part?')) deleteMutation.mutate()
            }}
            className="p-1.5 text-gray-600 hover:text-red-400 active:text-red-500 transition-colors"
          >
            <Trash2 size={15} />
          </button>
        </div>

        {/* Hidden file input — capture="environment" opens rear camera on mobile */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoFile}
        />
      </div>
    </div>
  )
}

// ── Main RODetail page ────────────────────────────────────────────────────────
export default function RODetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [addPartOpen, setAddPartOpen] = useState(false)
  const [addSRCOpen, setAddSRCOpen] = useState(false)

  const { data: ro, isLoading, error } = useQuery({
    queryKey: ['ro', id],
    queryFn: () => rosApi.get(id),
  })

  const archiveMutation = useMutation({
    mutationFn: () => ro.archived ? rosApi.unarchive(id) : rosApi.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ros'] })
      queryClient.invalidateQueries({ queryKey: ['ro', id] })
      toast.success(ro.archived ? 'RO unarchived' : 'RO archived')
    },
    onError: (err) => toast.error(err.message),
  })

  const aphMutation = useMutation({
    mutationFn: () => telegramApi.sendAPH(id),
    onSuccess: () => toast.success('Telegram sent to Billy ✅'),
    onError: (err) => toast.error(err.message || 'Failed to send Telegram'),
  })

  const uploadMutation = useMutation({
    mutationFn: (file) => invoicesApi.upload(id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ro', id] })
      toast.success('Invoice uploaded')
    },
    onError: (err) => toast.error(err.message || 'Upload failed'),
  })

  const removeInvoiceMutation = useMutation({
    mutationFn: (invId) => invoicesApi.remove(invId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ro', id] })
      toast.success('Invoice removed')
    },
    onError: (err) => toast.error(err.message),
  })

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) uploadMutation.mutate(file)
    e.target.value = ''
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error || !ro) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-red-400">Failed to load RO</p>
        <Button variant="secondary" size="sm" onClick={() => navigate(-1)} className="mt-4">Go Back</Button>
      </div>
    )
  }

  const parts = ro.parts || []
  const invoices = ro.invoices || []
  const srcEntries = ro.srcEntries || []
  const activity = ro.activityLog || []

  return (
    <div className="overflow-y-auto pb-28">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800/60 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 -ml-2 rounded-xl text-gray-400 hover:text-gray-100 hover:bg-gray-800 active:bg-gray-700 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-gray-100 font-mono">{ro.roNumber}</h1>
            <PartsBadge status={ro.partsStatus} />
          </div>
          <p className="text-xs text-gray-500 truncate">
            {[ro.vehicleYear, ro.vehicleMake, ro.vehicleModel].filter(Boolean).join(' ')}
          </p>
        </div>
        <button
          onClick={() => setEditOpen(true)}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
        >
          <Edit2 size={18} />
        </button>
      </div>

      <div className="px-4 py-4">
        {/* Vehicle info card */}
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 mb-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {ro.vin && (
              <div className="col-span-2">
                <p className="text-xs text-gray-500 mb-0.5">VIN</p>
                <p className="text-gray-200 font-mono text-xs">{ro.vin}</p>
              </div>
            )}
            {ro.color && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Color</p>
                <p className="text-gray-200">{ro.color}</p>
              </div>
            )}
            {ro.vendor?.name && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Vendor</p>
                <p className="text-gray-200">{ro.vendor.name}</p>
              </div>
            )}
            {ro.productionStage && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Stage</p>
                <p className="text-blue-400 font-medium">{ro.productionStage}</p>
              </div>
            )}
          </div>

          <div className="mt-3 pt-3 border-t border-gray-700/50 flex items-center gap-2 flex-wrap">
            <Button
              variant={ro.archived ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => archiveMutation.mutate()}
              loading={archiveMutation.isPending}
              className="text-gray-400"
            >
              {ro.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
              {ro.archived ? 'Unarchive' : 'Archive RO'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => aphMutation.mutate()}
              loading={aphMutation.isPending}
              className="text-emerald-400 hover:text-emerald-300"
            >
              <Send size={15} />
              APH
            </Button>
          </div>
        </div>

        {/* Parts section */}
        <Section
          title={`Parts (${parts.length})`}
          action={
            <button
              onClick={() => setAddPartOpen(true)}
              className="flex items-center gap-1 text-xs text-blue-400 font-semibold"
            >
              <Plus size={14} /> Add
            </button>
          }
        >
          {parts.length === 0 ? (
            <p className="text-sm text-gray-600 py-2 text-center">No parts yet — tap Add to get started</p>
          ) : (
            parts.map((p) => <PartRow key={p.id} part={p} roId={id} />)
          )}
        </Section>

        {/* Invoices section */}
        <Section
          title={`Invoices (${invoices.length})`}
          action={
            <label className="flex items-center gap-1 text-xs text-blue-400 font-semibold cursor-pointer">
              <Upload size={14} />
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileChange} />
            </label>
          }
          defaultOpen={false}
        >
          {invoices.length === 0 ? (
            <p className="text-sm text-gray-600 py-2 text-center">No invoices uploaded</p>
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 bg-gray-800 border border-gray-700/40 rounded-xl px-3.5 py-3">
                  <FileText size={16} className="text-gray-400 shrink-0" />
                  <span className="flex-1 text-sm text-gray-200 truncate">{inv.originalFilename}</span>
                  <a
                    href={invoicesApi.fileUrl(inv.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <ExternalLink size={15} />
                  </a>
                  <button
                    onClick={() => {
                      if (window.confirm('Remove this invoice?')) removeInvoiceMutation.mutate(inv.id)
                    }}
                    className="p-1.5 text-gray-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* SRC section */}
        <Section
          title={`S.R.C. (${srcEntries.length})`}
          action={
            <button
              onClick={() => setAddSRCOpen(true)}
              className="flex items-center gap-1 text-xs text-blue-400 font-semibold"
            >
              <Plus size={14} /> Add
            </button>
          }
          defaultOpen={false}
        >
          {srcEntries.length === 0 ? (
            <p className="text-sm text-gray-600 py-2 text-center">No SRC entries</p>
          ) : (
            <div className="space-y-2">
              {srcEntries.map((entry) => (
                <div key={entry.id} className="bg-gray-800 border border-gray-700/40 rounded-xl px-3.5 py-3">
                  <div className="flex items-center justify-between">
                    <Badge variant={entry.status === 'COMPLETED' ? 'green' : 'orange'}>
                      {entry.entryType}
                    </Badge>
                    <span className="text-xs text-gray-500">{formatDate(entry.createdAt)}</span>
                  </div>
                  {entry.note && (
                    <p className="text-sm text-gray-300 mt-1.5">{entry.note}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Activity log */}
        {activity.length > 0 && (
          <Section title="Activity" defaultOpen={false}>
            <div className="space-y-3">
              {activity.slice(0, 20).map((log) => (
                <div key={log.id} className="flex gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-600 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-sm text-gray-300">{log.message}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{formatDate(log.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Modals */}
      {ro && <EditROModal open={editOpen} onClose={() => setEditOpen(false)} ro={ro} />}
      <AddPartModal open={addPartOpen} onClose={() => setAddPartOpen(false)} roId={id} />
      <AddSRCModal open={addSRCOpen} onClose={() => setAddSRCOpen(false)} roId={id} />
    </div>
  )
}
