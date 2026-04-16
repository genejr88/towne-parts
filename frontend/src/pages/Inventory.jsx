import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Package, Plus, Search, Edit2, Trash2, X, Camera, Image, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { inventoryApi } from '@/lib/api'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Spinner from '@/components/ui/Spinner'

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ src, onClose }) {
  return (
    <AnimatePresence>
      {src && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-xl bg-gray-800 text-gray-300 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
          <motion.img
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            src={src}
            alt="Inventory photo"
            className="max-w-full max-h-full object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Part form modal (Add / Edit + photo management) ───────────────────────────
function PartModal({ open, onClose, part }) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)
  const [lightboxSrc, setLightboxSrc] = useState(null)

  const isEdit = Boolean(part)
  const [form, setForm] = useState({
    partNumber: part?.partNumber || '',
    description: part?.description || '',
    qty: part?.qty?.toString() || '1',
    notes: part?.notes || '',
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const saveMutation = useMutation({
    mutationFn: (data) =>
      isEdit ? inventoryApi.update(part.id, data) : inventoryApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      toast.success(isEdit ? 'Part updated' : 'Part added')
      if (!isEdit) onClose()
    },
    onError: (err) => toast.error(err.message || 'Failed to save'),
  })

  const uploadMutation = useMutation({
    mutationFn: (file) => inventoryApi.uploadPhoto(part?.id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      toast.success('Photo uploaded')
    },
    onError: (err) => toast.error(err.message || 'Upload failed'),
  })

  const deletePhotoMutation = useMutation({
    mutationFn: (photoId) => inventoryApi.deletePhoto(photoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      toast.success('Photo removed')
    },
    onError: (err) => toast.error(err.message),
  })

  const handleSave = () => {
    if (!form.description.trim()) {
      toast.error('Description is required')
      return
    }
    saveMutation.mutate({
      partNumber: form.partNumber.trim() || undefined,
      description: form.description.trim(),
      qty: parseInt(form.qty) || 1,
      notes: form.notes.trim() || undefined,
    })
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) uploadMutation.mutate(file)
    e.target.value = ''
  }

  // When editing, grab the latest photos from the query cache
  const cachedParts = queryClient.getQueryData(['inventory'])
  const currentPhotos = isEdit
    ? (cachedParts?.find?.((p) => p.id === part.id)?.photos ?? part.photos ?? [])
    : []

  return (
    <>
      <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Part' : 'Add Part'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Part Number (optional)"
              value={form.partNumber}
              onChange={set('partNumber')}
              placeholder="ABC-123"
            />
            <Input
              label="Qty"
              type="number"
              value={form.qty}
              onChange={set('qty')}
              min="1"
            />
          </div>
          <Input
            label="Description"
            value={form.description}
            onChange={set('description')}
            placeholder="Front bumper cover"
          />
          <Textarea
            label="Notes (optional)"
            value={form.notes}
            onChange={set('notes')}
            rows={2}
            placeholder="Location, condition, etc."
          />

          {/* Photo section — only shown when editing an existing part */}
          {isEdit && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-2">Photos</p>
              <div className="flex flex-wrap gap-2">
                {currentPhotos.map((photo) => (
                  <div key={photo.id} className="relative group shrink-0">
                    <img
                      src={inventoryApi.photoUrl(photo.storedPath)}
                      alt={photo.originalFilename}
                      className="w-16 h-16 object-cover rounded-lg border border-gray-600 cursor-pointer hover:border-blue-400 transition-colors"
                      onClick={() => setLightboxSrc(inventoryApi.photoUrl(photo.storedPath))}
                    />
                    <button
                      onClick={() => {
                        if (window.confirm('Remove this photo?')) {
                          deletePhotoMutation.mutate(photo.id)
                        }
                      }}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={10} className="text-white" />
                    </button>
                  </div>
                ))}

                {/* Add photo button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadMutation.isPending}
                  className="w-16 h-16 border-2 border-dashed border-gray-600 rounded-lg flex flex-col items-center justify-center text-gray-500 hover:border-blue-400 hover:text-blue-400 transition-colors disabled:opacity-40 shrink-0"
                >
                  {uploadMutation.isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>
                      <Camera size={14} />
                      <span className="text-[9px] mt-0.5">Add</span>
                    </>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
            <Button
              variant="primary"
              loading={saveMutation.isPending}
              onClick={handleSave}
              className="flex-1"
            >
              {isEdit ? 'Save' : 'Add Part'}
            </Button>
          </div>
        </div>
      </Modal>

      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </>
  )
}

// ── Inventory part card ───────────────────────────────────────────────────────
function PartCard({ part, onEdit, onDelete }) {
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const firstPhoto = part.photos?.[0]

  return (
    <>
      <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 flex gap-3">
        {/* Thumbnail */}
        {firstPhoto ? (
          <button
            onClick={() => setLightboxSrc(inventoryApi.photoUrl(firstPhoto.storedPath))}
            className="w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-gray-600 hover:border-blue-400 transition-colors"
          >
            <img
              src={inventoryApi.photoUrl(firstPhoto.storedPath)}
              alt={firstPhoto.originalFilename}
              className="w-full h-full object-cover"
            />
          </button>
        ) : (
          <div className="w-16 h-16 shrink-0 rounded-lg bg-gray-700/40 border border-gray-700 flex items-center justify-center">
            <Image size={20} className="text-gray-600" />
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              {part.partNumber && (
                <p className="text-xs font-mono font-semibold text-gray-400 truncate">{part.partNumber}</p>
              )}
              <p className="text-sm font-medium text-gray-100 leading-snug">{part.description}</p>
            </div>
            <span className="shrink-0 text-xs bg-blue-500/15 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full font-semibold">
              ×{part.qty}
            </span>
          </div>
          {part.notes && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{part.notes}</p>
          )}
          {part.photos?.length > 1 && (
            <p className="text-xs text-gray-600 mt-1">{part.photos.length} photos</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={() => onEdit(part)}
            className="p-1.5 text-gray-500 hover:text-blue-400 transition-colors"
            title="Edit"
          >
            <Edit2 size={15} />
          </button>
          <button
            onClick={() => onDelete(part)}
            className="p-1.5 text-gray-600 hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </>
  )
}

// ── Main Inventory page ───────────────────────────────────────────────────────
export default function Inventory() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editingPart, setEditingPart] = useState(null)

  const { data: parts = [], isLoading } = useQuery({
    queryKey: ['inventory', search],
    queryFn: () => inventoryApi.list(search || undefined),
    keepPreviousData: true,
  })

  // Also keep a non-filtered cache for RODetail matching
  const { } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.list(),
    staleTime: 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => inventoryApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      toast.success('Part deleted')
    },
    onError: (err) => toast.error(err.message || 'Failed to delete'),
  })

  const handleDelete = (part) => {
    if (window.confirm(`Delete "${part.description}"? This cannot be undone.`)) {
      deleteMutation.mutate(part.id)
    }
  }

  return (
    <div className="overflow-y-auto pb-28">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800/60 px-4 py-3 flex items-center gap-3">
        <Package size={20} className="text-blue-400 shrink-0" />
        <h1 className="flex-1 text-base font-bold text-gray-100">Parts Inventory</h1>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors"
        >
          <Plus size={16} />
          Add Part
        </button>
      </div>

      <div className="px-4 py-4 space-y-3">
        {/* Search bar */}
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by part number or description…"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Parts list */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : parts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-800 flex items-center justify-center">
              <Package size={24} className="text-gray-600" />
            </div>
            <p className="text-gray-400 font-medium">
              {search ? 'No parts match your search' : 'No inventory parts yet'}
            </p>
            {!search && (
              <p className="text-sm text-gray-600 max-w-xs">
                Add surplus parts here so staff can see what's already in stock when reviewing ROs.
              </p>
            )}
          </div>
        ) : (
          <motion.div
            initial={false}
            className="space-y-2"
          >
            {parts.map((part) => (
              <motion.div
                key={part.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <PartCard
                  part={part}
                  onEdit={(p) => setEditingPart(p)}
                  onDelete={handleDelete}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Add modal */}
      <AnimatePresence>
        {addOpen && (
          <PartModal open={addOpen} onClose={() => setAddOpen(false)} part={null} />
        )}
      </AnimatePresence>

      {/* Edit modal */}
      <AnimatePresence>
        {editingPart && (
          <PartModal
            open={Boolean(editingPart)}
            onClose={() => setEditingPart(null)}
            part={editingPart}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
