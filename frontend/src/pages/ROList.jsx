import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Plus, X, ChevronRight, Car, Package, Archive, RefreshCw, Upload, Camera, ArchiveRestore, CheckCircle2, PackageX } from 'lucide-react'
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
  { key: 'no_parts', label: 'No Parts' },
  { key: 'archived', label: 'Archived' },
]

function BmwRoundel({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
      <circle cx="12" cy="12" r="11" fill="#111827" />
      <path d="M12 2A10 10 0 0 0 2 12h10V2z"   fill="#0065B3" />
      <path d="M12 22A10 10 0 0 0 22 12H12v10z" fill="#0065B3" />
      <path d="M22 12A10 10 0 0 0 12 2v10h10z"  fill="#f0f0f0" />
      <path d="M2 12A10 10 0 0 0 12 22V12H2z"   fill="#f0f0f0" />
      <circle cx="12" cy="12" r="10" fill="none" stroke="#1f2937" strokeWidth="1.5" />
      <line x1="12" y1="2"  x2="12" y2="22" stroke="#1f2937" strokeWidth="1" />
      <line x1="2"  y1="12" x2="22" y2="12" stroke="#1f2937" strokeWidth="1" />
    </svg>
  )
}

function ROCard({ ro, onClick, onUnarchive }) {
  const statusBg = ro.isBmw
    ? 'border-l-blue-500'
    : ro.noPartsRequired
    ? 'border-l-violet-500'
    : ({
        MISSING: 'border-l-red-500',
        ACKNOWLEDGED: 'border-l-amber-500',
        ALL_HERE: 'border-l-emerald-500',
      }[ro.partsStatus] || 'border-l-gray-600')

  const cardBg = ro.isBmw
    ? 'bg-blue-950/30'
    : ro.noPartsRequired
    ? 'bg-violet-950/20'
    : 'bg-gray-800/80'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border border-gray-700/60 rounded-xl border-l-4 overflow-hidden ${statusBg} ${cardBg}`}
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
              {ro.noPartsRequired ? (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-600/20 border border-violet-500/40 text-violet-300">
                  <PackageX size={11} />
                  No Parts
                </span>
              ) : (
                <PartsBadge status={ro.partsStatus} />
              )}
              {ro.isBmw && (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-300">
                  <BmwRoundel size={11} />
                  BMW
                </span>
              )}
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

const EMPTY_FORM = {
  roNumber: '', vehicleYear: '', vehicleMake: '', vehicleModel: '',
  vehicleColor: '', vin: '', vendorId: '',
  ownerName: '', insuranceCompany: '', claimNumber: '',
  isBmw: false,
}

function CreateROModal({ open, onClose }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(EMPTY_FORM)
  const [addedCount, setAddedCount] = useState(0)
  const [lastAdded, setLastAdded] = useState(null)
  // formKey increments after each save — remounts the form so autoFocus fires again
  const [formKey, setFormKey] = useState(0)

  // Reset everything when modal opens fresh
  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM)
      setAddedCount(0)
      setLastAdded(null)
      setFormKey(0)
    }
  }, [open])

  const { data: vendors } = useQuery({
    queryKey: ['vendors'],
    queryFn: vendorsApi.list,
    enabled: open,
  })

  // Auto-select the default vendor once vendors load
  useEffect(() => {
    if (open && vendors?.length > 0) {
      const def = vendors.find((v) => v.isDefault)
      if (def) {
        setForm((f) => f.vendorId ? f : { ...f, vendorId: String(def.id) })
      }
    }
  }, [vendors, open])

  // Auto-select vendor by make + auto-flag BMW when vehicleMake changes
  useEffect(() => {
    if (!form.vehicleMake?.trim()) return
    const make = form.vehicleMake.trim().toLowerCase()
    const isBmw = make === 'bmw'
    setForm((f) => ({ ...f, isBmw }))
    if (!vendors?.length) return
    const match = vendors.find((v) => v.make && v.make.toLowerCase() === make)
    if (match) setForm((f) => ({ ...f, vendorId: String(match.id), isBmw }))
  }, [form.vehicleMake, vendors])

  const mutation = useMutation({
    mutationFn: (data) => rosApi.create(data),
    onSuccess: (ro) => {
      queryClient.invalidateQueries({ queryKey: ['ros'] })
      toast.success(`RO ${ro.roNumber} created`)
      setLastAdded(ro.roNumber)
      setAddedCount((c) => c + 1)
      // Keep the vendor selection, clear everything else, bump key to re-focus
      setForm((f) => ({ ...EMPTY_FORM, vendorId: f.vendorId }))
      setFormKey((k) => k + 1)
    },
    onError: (err) => toast.error(err.message || 'Failed to create RO'),
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.roNumber.trim()) { toast.error('RO number is required'); return }
    mutation.mutate({
      roNumber:         form.roNumber.trim(),
      vehicleYear:      form.vehicleYear      || null,
      vehicleMake:      form.vehicleMake      || null,
      vehicleModel:     form.vehicleModel     || null,
      vehicleColor:     form.vehicleColor     || null,
      vin:              form.vin              || null,
      vendorId:         form.vendorId         || null,
      ownerName:        form.ownerName        || null,
      insuranceCompany: form.insuranceCompany || null,
      claimNumber:      form.claimNumber      || null,
      isBmw:            form.isBmw,
    })
  }

  const handleClose = () => {
    setForm(EMPTY_FORM)
    setAddedCount(0)
    setLastAdded(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Repair Orders">
      {/* Running tally */}
      {addedCount > 0 && (
        <div className="flex items-center gap-2 bg-emerald-950/40 border border-emerald-700/40 rounded-xl px-3 py-2 mb-4">
          <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-300">
            <span className="font-bold">{addedCount}</span> {addedCount === 1 ? 'RO' : 'ROs'} added this session
            {lastAdded && <span className="text-emerald-500/70"> · Last: #{lastAdded}</span>}
          </p>
        </div>
      )}

      <form key={formKey} onSubmit={handleSubmit} className="space-y-3">
        <Input
          label="RO Number *"
          value={form.roNumber}
          onChange={set('roNumber')}
          placeholder="e.g. 12345"
          autoFocus
        />

        {/* Year / Make / Model on one row */}
        <div className="grid grid-cols-3 gap-2">
          <Input label="Year"  value={form.vehicleYear}  onChange={set('vehicleYear')}  placeholder="2024" />
          <Input label="Make"  value={form.vehicleMake}  onChange={set('vehicleMake')}  placeholder="Toyota" />
          <Input label="Model" value={form.vehicleModel} onChange={set('vehicleModel')} placeholder="Camry" />
        </div>

        {/* Color / VIN */}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Color" value={form.vehicleColor} onChange={set('vehicleColor')} placeholder="Silver" />
          <Input label="VIN (optional)" value={form.vin} onChange={set('vin')} placeholder="17 chars" maxLength={17} />
        </div>

        {/* Customer / Insurance */}
        <div className="border-t border-gray-700/40 pt-3 space-y-3">
          <Input label="Customer Name" value={form.ownerName} onChange={set('ownerName')} placeholder="Jane Smith" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Insurance Co." value={form.insuranceCompany} onChange={set('insuranceCompany')} placeholder="State Farm" />
            <Input label="Claim #" value={form.claimNumber} onChange={set('claimNumber')} placeholder="CLM-00123" />
          </div>
        </div>

        <Select label="Vendor" value={form.vendorId} onChange={set('vendorId')}>
          <option value="">— Select vendor —</option>
          {vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>

        {/* BMW flag */}
        <button
          type="button"
          onClick={() => setForm((f) => ({ ...f, isBmw: !f.isBmw }))}
          className={`w-full flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-colors text-sm font-semibold ${
            form.isBmw
              ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
              : 'bg-gray-800/60 border-gray-700/50 text-gray-500 hover:text-gray-300'
          }`}
        >
          <BmwRoundel size={18} />
          {form.isBmw ? 'BMW Job ✓' : 'Mark as BMW Job'}
        </button>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={handleClose} className="flex-1">
            {addedCount > 0 ? 'Done' : 'Cancel'}
          </Button>
          <Button variant="primary" type="submit" loading={mutation.isPending} className="flex-1">
            Save &amp; Next →
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
    urlStatus && ['missing', 'acknowledged', 'all_here', 'no_parts', 'archived'].includes(urlStatus)
      ? urlStatus
      : 'active'
  )

  // Build query params
  const queryParams = {}
  if (activeFilter === 'archived') {
    queryParams.archived = true
  } else if (activeFilter === 'no_parts') {
    queryParams.archived = false
    queryParams.missingPartsList = true
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
