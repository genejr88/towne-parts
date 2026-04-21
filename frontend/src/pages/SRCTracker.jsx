import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  RotateCcw, Plus, Trash2, Camera, X, Link2,
  Package, Building2, CalendarDays, FileText,
  ArrowRight, BadgeCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { srcApi, rosApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Select from '@/components/ui/Select'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'

// Status → tab key mapping
const FILTER_TABS = [
  { key: 'open',     label: 'Open',     status: 'OPEN' },
  { key: 'returned', label: 'Returned', status: 'RETURNED' },
  { key: 'credited', label: 'Credited', status: 'CREDITED' },
]

function statusBadgeVariant(status) {
  if (status === 'RETURNED') return 'blue'
  if (status === 'CREDITED') return 'green'
  return 'orange'
}

function statusLabel(status) {
  if (status === 'RETURNED') return 'Returned'
  if (status === 'CREDITED') return 'Credited'
  return 'Open'
}

// ── SRC Card ─────────────────────────────────────────────────────────────────
function SRCCard({ entry, onMarkReturned, onMarkCredited, onDeletePhoto, onDelete }) {
  const isOpen     = entry.status === 'OPEN'
  const isReturned = entry.status === 'RETURNED'
  const isCredited = entry.status === 'CREDITED'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={`bg-gray-800/70 border rounded-xl overflow-hidden transition-colors ${
        isCredited ? 'border-gray-700/30 opacity-55' : 'border-gray-700/60'
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {/* Badges row */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Badge variant={statusBadgeVariant(entry.status)}>
                {statusLabel(entry.status)}
              </Badge>
              <Badge variant="default">
                {entry.entryType === 'CORE_RETURN' ? 'Core Return' : 'Return'}
              </Badge>
              {entry.ro?.roNumber && (
                <span className="text-xs font-mono font-semibold text-gray-300">
                  RO {entry.ro.roNumber}
                </span>
              )}
              {!entry.ro && (
                <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded-full">
                  No RO
                </span>
              )}
            </div>

            {/* Vehicle */}
            {entry.ro && (
              <p className="text-xs text-gray-500 mb-1.5">
                {[entry.ro.vehicleYear, entry.ro.vehicleMake, entry.ro.vehicleModel].filter(Boolean).join(' ')}
              </p>
            )}

            {/* Part details */}
            <div className="space-y-1 mb-2">
              {entry.partNumber && (
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Package size={11} className="text-gray-600 shrink-0" />
                  <span className="font-mono">{entry.partNumber}</span>
                </div>
              )}
              {entry.partDescription && (
                <div className="flex items-center gap-1.5 text-xs text-gray-300">
                  <FileText size={11} className="text-gray-600 shrink-0" />
                  <span>{entry.partDescription}</span>
                </div>
              )}
              {entry.vendorName && (
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Building2 size={11} className="text-gray-600 shrink-0" />
                  <span>{entry.vendorName}</span>
                </div>
              )}
              {entry.returnDate && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <CalendarDays size={11} className="text-gray-600 shrink-0" />
                  <span>{new Date(entry.returnDate).toLocaleDateString()}</span>
                </div>
              )}
            </div>

            {entry.note && (
              <p className="text-sm text-gray-300 mb-2">{entry.note}</p>
            )}

            {/* Photos */}
            {entry.photos?.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {entry.photos.map((photo) => (
                  <div key={photo.id} className="relative group">
                    <a href={srcApi.photoUrl(photo.storedPath)} target="_blank" rel="noopener noreferrer">
                      <img
                        src={srcApi.photoUrl(photo.storedPath)}
                        alt="Invoice"
                        className="w-16 h-16 object-cover rounded-lg border border-gray-700 hover:border-blue-500 transition-colors"
                        onError={(e) => {
                          e.target.style.display = 'none'
                          e.target.nextSibling.style.display = 'flex'
                        }}
                      />
                      <div className="hidden w-16 h-16 items-center justify-center rounded-lg border border-gray-700 bg-gray-700/50 text-gray-400">
                        <FileText size={22} />
                      </div>
                    </a>
                    {!isCredited && (
                      <button
                        onClick={() => onDeletePhoto(photo.id)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 rounded-full hidden group-hover:flex items-center justify-center"
                      >
                        <X size={10} className="text-white" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-gray-600">{formatDate(entry.createdAt)}</p>
          </div>

          <button
            onClick={() => onDelete(entry.id)}
            className="p-1.5 text-gray-600 hover:text-red-400 transition-colors shrink-0 mt-0.5"
          >
            <Trash2 size={15} />
          </button>
        </div>

        {/* Action buttons */}
        {!isCredited && (
          <div className="mt-3 pt-3 border-t border-gray-700/50 flex gap-2">
            {isOpen && (
              <button
                onClick={() => onMarkReturned(entry.id)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20 transition-colors"
              >
                <ArrowRight size={13} />
                Mark Returned
              </button>
            )}
            {isReturned && (
              <button
                onClick={() => onMarkCredited(entry.id)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/20 transition-colors"
              >
                <BadgeCheck size={13} />
                Mark Credited
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Create Modal ──────────────────────────────────────────────────────────────
function CreateSRCModal({ open, onClose }) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)
  const [form, setForm] = useState({
    entryType: 'RETURN',
    roId: '',
    partNumber: '',
    partDescription: '',
    vendorName: '',
    returnDate: new Date().toISOString().split('T')[0],
    note: '',
  })
  const [stagedFiles, setStagedFiles] = useState([])
  const [uploading, setUploading] = useState(false)

  const { data: ros } = useQuery({
    queryKey: ['ros', { archived: false }],
    queryFn: () => rosApi.list({ archived: false }),
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: (data) => srcApi.create(data),
    onSuccess: async (entry) => {
      if (stagedFiles.length > 0) {
        setUploading(true)
        try {
          await srcApi.uploadPhotos(entry.id, stagedFiles)
        } catch {
          toast.error('Entry created but photo upload failed')
        }
        setUploading(false)
      }
      queryClient.invalidateQueries({ queryKey: ['src'] })
      toast.success('SRC entry created')
      handleClose()
    },
    onError: (err) => toast.error(err.message || 'Failed to create'),
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length) setStagedFiles((prev) => [...prev, ...files])
  }

  const removeStagedFile = (idx) => setStagedFiles((prev) => prev.filter((_, i) => i !== idx))

  const handleClose = () => {
    setForm({
      entryType: 'RETURN',
      roId: '',
      partNumber: '',
      partDescription: '',
      vendorName: '',
      returnDate: new Date().toISOString().split('T')[0],
      note: '',
    })
    setStagedFiles([])
    onClose()
  }

  const handleSubmit = () => {
    mutation.mutate({
      entryType: form.entryType,
      roId: form.roId || undefined,
      partNumber: form.partNumber || undefined,
      partDescription: form.partDescription || undefined,
      vendorName: form.vendorName || undefined,
      returnDate: form.returnDate || undefined,
      note: form.note || undefined,
    })
  }

  return (
    <Modal open={open} onClose={handleClose} title="New S.R.C. Entry">
      <div className="space-y-3.5">
        <Select label="Type" value={form.entryType} onChange={set('entryType')}>
          <option value="RETURN">Return</option>
          <option value="CORE_RETURN">Core Return</option>
        </Select>

        <Select label="Repair Order (optional)" value={form.roId} onChange={set('roId')}>
          <option value="">— Not tied to an RO —</option>
          {ros?.map((ro) => (
            <option key={ro.id} value={ro.id}>
              {ro.roNumber}
              {ro.vehicleMake
                ? ` — ${[ro.vehicleYear, ro.vehicleMake, ro.vehicleModel].filter(Boolean).join(' ')}`
                : ''}
            </option>
          ))}
        </Select>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Part #" value={form.partNumber} onChange={set('partNumber')} placeholder="e.g. 68432-52" />
          <Input label="Return Date" type="date" value={form.returnDate} onChange={set('returnDate')} />
        </div>

        <Input label="Part Description" value={form.partDescription} onChange={set('partDescription')} placeholder="e.g. Front bumper cover" />
        <Input label="Vendor" value={form.vendorName} onChange={set('vendorName')} placeholder="e.g. LKQ, Keystone" />
        <Textarea label="Note" value={form.note} onChange={set('note')} rows={2} placeholder="Reason for return, condition, etc." />

        {/* Photo capture */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-2">Invoice / Part Photos</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          {stagedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {stagedFiles.map((file, idx) => (
                <div key={idx} className="relative">
                  {file.type.startsWith('image/') ? (
                    <img src={URL.createObjectURL(file)} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-700" />
                  ) : (
                    <div className="w-16 h-16 flex items-center justify-center rounded-lg border border-gray-700 bg-gray-700/50 text-gray-400">
                      <FileText size={22} />
                    </div>
                  )}
                  <button
                    onClick={() => removeStagedFile(idx)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center"
                  >
                    <X size={10} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors py-1"
          >
            <Camera size={16} />
            {stagedFiles.length > 0 ? 'Add more photos' : 'Capture / attach invoice'}
          </button>
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="secondary" onClick={handleClose} className="flex-1">Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending || uploading}
            onClick={handleSubmit}
            className="flex-1"
          >
            {uploading ? 'Uploading…' : 'Create Entry'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SRCTracker() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('open')
  const [createOpen, setCreateOpen] = useState(false)

  const queryParams = { status: activeTab }

  const { data: entries, isLoading } = useQuery({
    queryKey: ['src', queryParams],
    queryFn: () => srcApi.list(queryParams),
  })

  const updateStatus = (id, status, successMsg) =>
    srcApi.update(id, { status }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['src'] })
      toast.success(successMsg)
    }).catch((err) => toast.error(err.message))

  const deletePhotoMutation = useMutation({
    mutationFn: (photoId) => srcApi.deletePhoto(photoId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['src'] }); toast.success('Photo removed') },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => srcApi.remove(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['src'] }); toast.success('Entry removed') },
    onError: (err) => toast.error(err.message),
  })

  const handleDelete = (id) => {
    if (window.confirm('Delete this SRC entry?')) deleteMutation.mutate(id)
  }

  const handleShare = () => {
    const url = srcApi.publicPageUrl()
    navigator.clipboard.writeText(url)
      .then(() => toast.success('Live link copied!'))
      .catch(() => toast.error('Copy failed — URL: ' + url))
  }

  // Group: no-RO entries first, then by RO number
  const standalone = entries?.filter((e) => !e.ro) || []
  const byRO = {}
  entries?.filter((e) => e.ro).forEach((e) => {
    const key = e.ro.roNumber
    if (!byRO[key]) byRO[key] = { ro: e.ro, entries: [] }
    byRO[key].entries.push(e)
  })

  const totalCount = entries?.length ?? 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-gray-950/95 backdrop-blur-sm px-4 pt-3 pb-2 border-b border-gray-800/60 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-2.5">
          <h1 className="text-sm font-bold text-gray-300 uppercase tracking-widest">S.R.C. Tracker</h1>
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-xl transition-colors"
          >
            <Link2 size={13} />
            Share Live Link
          </button>
        </div>

        {/* Status flow hint */}
        <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-2.5">
          <span className="text-orange-500/70">Open</span>
          <ArrowRight size={11} />
          <span className="text-blue-500/70">Returned</span>
          <span className="text-gray-700 text-[10px]">(live on public link)</span>
          <ArrowRight size={11} />
          <span className="text-emerald-500/70">Credited</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {FILTER_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 ${
                activeTab === key
                  ? key === 'open'     ? 'bg-amber-600/80 text-white'
                  : key === 'returned' ? 'bg-blue-600 text-white'
                  :                      'bg-emerald-700/80 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {label}
              {activeTab === key && totalCount > 0 && (
                <span className="ml-1 text-xs opacity-70">({totalCount})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-28">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : entries?.length === 0 ? (
          <EmptyState
            icon={RotateCcw}
            title={
              activeTab === 'open'     ? 'No open entries' :
              activeTab === 'returned' ? 'Nothing returned yet' :
                                        'No credited entries'
            }
            description={
              activeTab === 'returned'
                ? 'Mark an open entry as "Returned" to show it on the live link'
                : ''
            }
          />
        ) : (
          <AnimatePresence>
            {/* Standalone (no RO) */}
            {standalone.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2.5">No RO</p>
                <div className="space-y-2">
                  {standalone.map((entry) => (
                    <SRCCard
                      key={entry.id}
                      entry={entry}
                      onMarkReturned={(id) => updateStatus(id, 'RETURNED', 'Marked as returned — now live on public link')}
                      onMarkCredited={(id) => updateStatus(id, 'CREDITED', 'Credited ✓')}
                      onDeletePhoto={deletePhotoMutation.mutate}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* By RO */}
            {Object.entries(byRO).map(([roNum, group]) => (
              <div key={roNum} className="mb-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">RO {roNum}</span>
                  <span className="text-xs text-gray-600">
                    {[group.ro.vehicleYear, group.ro.vehicleMake, group.ro.vehicleModel].filter(Boolean).join(' ')}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.entries.map((entry) => (
                    <SRCCard
                      key={entry.id}
                      entry={entry}
                      onMarkReturned={(id) => updateStatus(id, 'RETURNED', 'Marked as returned — now live on public link')}
                      onMarkCredited={(id) => updateStatus(id, 'CREDITED', 'Credited ✓')}
                      onDeletePhoto={deletePhotoMutation.mutate}
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
        className="fixed bottom-20 right-4 z-30 w-14 h-14 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-xl"
      >
        <Plus size={26} strokeWidth={2.5} />
      </motion.button>

      <CreateSRCModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
