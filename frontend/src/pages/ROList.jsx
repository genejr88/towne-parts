import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Plus, X, ChevronRight, Car, Package, Archive, RefreshCw, Upload, Camera, ArchiveRestore } from 'lucide-react'
import toast from 'react-hot-toast'
import { rosApi, vendorsApi } from '@/lib/api'
import { formatDate, STAGE_COLORS } from '@/lib/utils'
import PartsBadge from '@/components/ui/PartsBadge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import ImportPartsModal from '@/components/ImportPartsModal'

const FILTER_TABS = [
  { key: 'active', label: 'Active' },
  { key: 'missing', label: 'Missing' },
  { key: 'acknowledged', label: 'Ack\'d' },
  { key: 'all_here', label: 'All Here' },
  { key: 'archived', label: 'Archived' },
]

function ROCard({ ro, onClick, onUnarchive }) {
  const statusBg = {
    MISSING: 'border-l-red-500',
    ACKNOWLEDGED: 'border-l-amber-500',
    ALL_HERE: 'border-l-emerald-500',
  }[ro.partsStatus] || 'border-l-gray-600'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-gray-800/80 border border-gray-700/60 rounded-xl border-l-4 overflow-hidden ${statusBg}`}
    >
      <div
        onClick={onClick}
        className="p-4 cursor-pointer active:scale-[0.98] transition-transform"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-bold text-gray-100 font-mono">
                {ro.roNumber}
              </span>
              <PartsBadge status={ro.partsStatus} />
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-400 mb-1">
              <Car size={13} className="shrink-0" />
              <span className="truncate">
                {[ro.vehicleYear, ro.vehicleMake, ro.vehicleModel].filter(Boolean).join(' ') || 'No vehicle info'}
              </span>
            </div>
            {ro.vin && (
              <p className="text-xs text-gray-600 font-mono truncate">{ro.vin}</p>
            )}
            <div className="flex items-center gap-3 mt-2">
              {ro.vendor?.name && (
                <span className="text-xs text-gray-500">{ro.vendor.name}</span>
              )}
              {ro.productionStage && ro.productionStage.toLowerCase() !== 'unassigned' && (
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${STAGE_COLORS[ro.productionStage] || 'bg-gray-700/50 text-gray-400'}`}>
                  {ro.productionStage}
                </span>
              )}
              {ro.parts && ro.parts.length > 0 && (
                <span className="text-xs text-gray-500">
                  {ro.parts.filter(p => p.isReceived).length}/{ro.parts.length} parts
                </span>
              )}
            </div>
          </div>
          <ChevronRight size={18} className="text-gray-600 shrink-0 mt-1" />
        </div>
      </div>

      {/* Unarchive button — only shown on archived ROs */}
      {onUnarchive && (
        <div className="border-t border-gray-700/50 px-4 py-2.5 flex justify-end">
          <button
            onClick={(e) => { e.stopPropagation(); onUnarchive(ro) }}
            className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors"
          >
            <ArchiveRestore size={13} />
            Restore to Active
          </button>
        </div>
      )}
    </motion.div>
  )
}

function CreateROModal({ open, onClose }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    roNumber: '',
    vehicleYear: '',
    vehicleMake: '',
    vehicleModel: '',
    vin: '',
    vendorId: '',
    color: '',
  })

  const { data: vendors } = useQuery({
    queryKey: ['vendors'],
    queryFn: vendorsApi.list,
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: (data) => rosApi.create(data),
    onSuccess: (ro) => {
      queryClient.invalidateQueries({ queryKey: ['ros'] })
      toast.success(`RO ${ro.roNumber} created`)
      onClose()
      setForm({ roNumber: '', vehicleYear: '', vehicleMake: '', vehicleModel: '', vin: '', vendorId: '', color: '' })
    },
    onError: (err) => {
      toast.error(err.message || 'Failed to create RO')
    },
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.roNumber.trim()) {
      toast.error('RO number is required')
      return
    }
    mutation.mutate({
      ...form,
      vehicleYear: form.vehicleYear ? parseInt(form.vehicleYear) : undefined,
      vendorId: form.vendorId || undefined,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="New Repair Order">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="RO Number *"
          value={form.roNumber}
          onChange={set('roNumber')}
          placeholder="e.g. 12345"
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Year"
            type="number"
            value={form.vehicleYear}
            onChange={set('vehicleYear')}
            placeholder="2024"
            min="1980"
            max="2030"
          />
          <Input
            label="Color"
            value={form.color}
            onChange={set('color')}
            placeholder="Silver"
          />
        </div>
        <Input
          label="Make"
          value={form.vehicleMake}
          onChange={set('vehicleMake')}
          placeholder="Toyota"
        />
        <Input
          label="Model"
          value={form.vehicleModel}
          onChange={set('vehicleModel')}
          placeholder="Camry"
        />
        <Input
          label="VIN"
          value={form.vin}
          onChange={set('vin')}
          placeholder="17-char VIN"
          maxLength={17}
        />
        <Select
          label="Vendor"
          value={form.vendorId}
          onChange={set('vendorId')}
        >
          <option value="">— Select vendor —</option>
          {vendors?.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </Select>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={mutation.isPending} className="flex-1">
            Create RO
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default function ROList() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // Read filter from URL or default to 'active'
  const urlStatus = searchParams.get('status')
  const [activeFilter, setActiveFilter] = useState(
    urlStatus && ['missing', 'acknowledged', 'all_here', 'archived'].includes(urlStatus)
      ? urlStatus
      : 'active'
  )

  // Build query params
  const queryParams = {}
  if (activeFilter === 'archived') {
    queryParams.archived = true
  } else {
    queryParams.archived = false
    if (activeFilter !== 'active') {
      queryParams.partsStatus = activeFilter.toUpperCase()
    }
  }
  if (search.trim()) {
    queryParams.search = search.trim()
  }

  const queryClient = useQueryClient()

  const { data: ros, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['ros', queryParams],
    queryFn: () => rosApi.list(queryParams),
  })

  const unarchiveMutation = useMutation({
    mutationFn: (id) => rosApi.unarchive(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ros'] })
      toast.success(`RO ${data.roNumber} restored to active`)
    },
    onError: (err) => toast.error(err.message || 'Failed to restore RO'),
  })

  // Sync URL when filter changes
  useEffect(() => {
    const params = {}
    if (activeFilter !== 'active') params.status = activeFilter
    setSearchParams(params, { replace: true })
  }, [activeFilter])

  const handleFilterChange = (key) => {
    setActiveFilter(key)
    setSearch('')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + filter area (sticky) */}
      <div className="bg-gray-950/95 backdrop-blur-sm px-4 pt-3 pb-2 sticky top-0 z-10 border-b border-gray-800/60">
        {/* Search bar */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search RO #, make, model, VIN, part #..."
            className="w-full bg-gray-800/70 border border-gray-700/50 rounded-xl pl-10 pr-10 py-2.5 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {FILTER_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleFilterChange(key)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 ${
                activeFilter === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200 active:bg-gray-700'
              }`}
            >
              {label}
              {ros && key === activeFilter && (
                <span className="ml-1.5 text-[10px] opacity-70">({ros.length})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* RO list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-28 space-y-2.5">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Spinner size="lg" />
          </div>
        ) : ros?.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No repair orders found"
            description={search ? 'Try a different search term' : 'Tap + to create the first RO'}
          />
        ) : (
          <AnimatePresence>
            {ros?.map((ro) => (
              <ROCard
                key={ro.id}
                ro={ro}
                onClick={() => navigate(`/ros/${ro.id}`)}
                onUnarchive={activeFilter === 'archived' ? (r) => unarchiveMutation.mutate(r.id) : undefined}
              />
            ))}
          </AnimatePresence>
        )}

        {/* Pull-to-refresh hint */}
        {ros && ros.length > 0 && (
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="w-full py-3 text-xs text-gray-600 flex items-center justify-center gap-1.5"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
            {isFetching ? 'Refreshing...' : 'Tap to refresh'}
          </button>
        )}
      </div>

      {/* Photo Import FAB */}
      <motion.button
        whileTap={{ scale: 0.93 }}
        onClick={() => setImportOpen(true)}
        className="fixed bottom-20 right-36 z-30 w-14 h-14 rounded-2xl bg-gray-700 hover:bg-gray-600 text-white flex items-center justify-center shadow-xl"
        title="Photo Import — point camera at estimate"
      >
        <Camera size={22} strokeWidth={2} />
      </motion.button>

      {/* Import FAB */}
      <motion.button
        whileTap={{ scale: 0.93 }}
        onClick={() => setImportOpen(true)}
        className="fixed bottom-20 right-20 z-30 w-14 h-14 rounded-2xl bg-gray-700 hover:bg-gray-600 text-white flex items-center justify-center shadow-xl"
        title="Import Parts List PDF"
      >
        <Upload size={22} strokeWidth={2} />
      </motion.button>

      {/* FAB */}
      <motion.button
        whileTap={{ scale: 0.93 }}
        onClick={() => setCreateOpen(true)}
        className="fixed bottom-20 right-4 z-30 w-14 h-14 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-glow shadow-xl"
      >
        <Plus size={26} strokeWidth={2.5} />
      </motion.button>

      <CreateROModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ImportPartsModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}
