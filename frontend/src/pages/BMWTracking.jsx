import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Trash2, X, Camera, FileText, Image, Lock, Plus } from 'lucide-react'
import { privateApi } from '@/lib/api'
import Spinner from '@/components/ui/Spinner'

// Helper to check if a stored file is an image
function isImage(filename) {
  return /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp)$/i.test(filename || '')
}

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
      {/* Thumbnail or file icon */}
      {isImage(file.originalFilename || file.storedPath) ? (
        <a href={imgSrc} target="_blank" rel="noopener noreferrer">
          <img
            src={imgSrc}
            alt={file.caption || file.originalFilename || 'Private file'}
            className="w-full h-44 object-cover"
            onError={(e) => { e.target.style.display = 'none' }}
          />
        </a>
      ) : (
        <a
          href={imgSrc}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center justify-center h-44 gap-2 bg-gray-800/40 hover:bg-gray-700/40 transition-colors"
        >
          <FileText size={36} className="text-gray-500" />
          <span className="text-xs text-gray-400 px-3 text-center truncate max-w-full">
            {file.originalFilename || file.storedPath}
          </span>
        </a>
      )}

      {/* Caption + date */}
      <div className="px-3 py-2.5">
        {file.caption && (
          <p className="text-sm text-gray-200 font-medium leading-snug">{file.caption}</p>
        )}
        <p className="text-[11px] text-gray-500 mt-0.5">
          {new Date(file.createdAt).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
          })}
        </p>
      </div>

      {/* Delete control */}
      <div className="absolute top-2 right-2">
        {confirmDelete ? (
          <div className="flex gap-1.5">
            <button
              onClick={() => onDelete(file.id)}
              className="px-2.5 py-1 text-xs font-semibold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2 py-1 text-xs bg-gray-800/90 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="p-1.5 bg-gray-900/70 rounded-lg text-gray-400 hover:text-red-400 transition-colors backdrop-blur-sm"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </motion.div>
  )
}

export default function BMWTracking() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const pin = sessionStorage.getItem('private_pin')
  const fileInputRef = useRef(null)

  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  // Guard: if no PIN in session, send them home
  useEffect(() => {
    if (!pin) navigate('/', { replace: true })
  }, [pin, navigate])

  const { data: files, isLoading } = useQuery({
    queryKey: ['private-files'],
    queryFn: () => privateApi.listFiles(pin),
    enabled: !!pin,
  })

  const deleteMutation = useMutation({
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

  if (!pin) return null

  return (
    <div className="px-4 py-5 pb-28 max-w-lg mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-6"
      >
        <div>
          <h1 className="text-xl font-bold text-gray-100 tracking-tight">BMW RO TRACKING</h1>
          <p className="text-xs text-gray-500 mt-0.5">Private — secured</p>
        </div>
        <button
          onClick={handleLock}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-800/80 border border-gray-700/50 text-xs text-gray-400 hover:text-red-400 transition-colors"
        >
          <Lock size={13} />
          Lock
        </button>
      </motion.div>

      {/* Upload area */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="mb-6 bg-gray-800/50 border border-gray-700/50 rounded-2xl p-4"
      >
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Add File</p>

        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption / note (optional)"
          className="w-full bg-gray-900/60 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 mb-3"
        />

        <div className="flex gap-2">
          <button
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.removeAttribute('capture')
                fileInputRef.current.click()
              }
            }}
            disabled={uploading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-700/80 hover:bg-gray-600/80 disabled:opacity-40 text-sm font-medium text-gray-200 transition-colors"
          >
            <Upload size={15} />
            File
          </button>
          <button
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.setAttribute('capture', 'environment')
                fileInputRef.current.click()
              }
            }}
            disabled={uploading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-700/80 hover:bg-gray-600/80 disabled:opacity-40 text-sm font-medium text-gray-200 transition-colors"
          >
            <Camera size={15} />
            Camera
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
          onChange={handleFileChange}
          className="hidden"
        />

        {uploading && (
          <div className="flex items-center justify-center gap-2 mt-3 text-xs text-gray-400">
            <Spinner size="sm" /> Uploading…
          </div>
        )}
        {uploadError && (
          <p className="text-xs text-red-400 mt-2 text-center">{uploadError}</p>
        )}
      </motion.div>

      {/* Files grid */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : files?.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3 py-16 text-center"
        >
          <div className="w-14 h-14 rounded-2xl bg-gray-800/60 flex items-center justify-center">
            <Image size={26} className="text-gray-600" />
          </div>
          <p className="text-gray-500 text-sm">No files yet. Upload one above.</p>
        </motion.div>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="grid grid-cols-2 gap-3">
            {files.map((file) => (
              <PrivateFileCard
                key={file.id}
                file={file}
                pin={pin}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            ))}
          </div>
        </AnimatePresence>
      )}
    </div>
  )
}
