import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FilePlus, FileCheck, Clock, ChevronRight, X, Trash2, Check,
  FileText, Send, Download, Warehouse, AlertTriangle, Save,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { jsPDF } from 'jspdf'
import { supplementsApi, prestorageApi, rosApi } from '@/lib/api'
import Spinner from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

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

function fmtFullDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

// Skip weekends to find nth business day from a given date
function addBusinessDays(date, n) {
  const d = new Date(date)
  let count = 0
  while (count < n) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return d
}

// ── PDF Generator ────────────────────────────────────────────────────────────
function generatePrestoragePDF(ro) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 25
  const maxW = W - margin * 2

  const today = new Date()
  const storageStart = addBusinessDays(today, 2)

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')

  // ── Right-aligned letterhead ──────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.text('TOWNE BODY SHOP', W - margin, 22, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.text('1298 Stratford Avenue', W - margin, 28, { align: 'right' })
  doc.text('Stratford, CT 06615', W - margin, 34, { align: 'right' })
  doc.text('203-375-5288', W - margin, 40, { align: 'right' })

  // ── Date ─────────────────────────────────────────────────────────
  let y = 58
  doc.text(fmtFullDate(today), margin, y)

  // ── Addressee block ──────────────────────────────────────────────
  y = 74
  doc.text(ro.insuranceCompany || '[Insurance Company]', margin, y)

  y = 88
  if (ro.claimNumber) { doc.text(ro.claimNumber, margin, y); y += 6 }
  doc.text(ro.ownerName || '[Customer Name]', margin, y); y += 6
  const vehicle = [ro.vehicleYear, ro.vehicleMake, ro.vehicleModel].filter(Boolean).join(' ') || '[Year Make Model]'
  doc.text(vehicle, margin, y)

  // ── Salutation ───────────────────────────────────────────────────
  y = 118
  doc.text('To Whom it may concern,', margin, y)

  // ── Paragraph 1 ──────────────────────────────────────────────────
  y += 9
  const p1 = 'We are notifying you that there is a pending supplement on this vehicle. In accordance with Connecticut statute 38a-790-7, as the repairer we are requesting a Connecticut licensed appraiser complete the supplement in person at our facility. Our company policy does not permit the use of virtual desk reviews.'
  const lines1 = doc.splitTextToSize(p1, maxW)
  doc.text(lines1, margin, y)
  y += lines1.length * 5.5 + 9

  // ── Paragraph 2 ──────────────────────────────────────────────────
  const p2 = `In an effort to better service our customers and reduce unnecessary delays, storage charges of $125 for the first five days and $175 beyond the fifth day will be charged on any vehicle that is not inspected within 2 business days of the date of this notification. The initial request was sent today, ${fmtFullDate(today)}. Storage will occur starting ${fmtFullDate(storageStart)}.`
  const lines2 = doc.splitTextToSize(p2, maxW)
  doc.text(lines2, margin, y)
  y += lines2.length * 5.5 + 9

  // ── Paragraph 3 ──────────────────────────────────────────────────
  const p3 = 'In accordance with Connecticut statute 14-65i, signage explaining the conditions in which storage charges may be imposed is posted in our office. Furthermore, Connecticut law requires that we grant 8 hours of free storage. Our policy provides 2 days of free storage.'
  const lines3 = doc.splitTextToSize(p3, maxW)
  doc.text(lines3, margin, y)
  y += lines3.length * 5.5 + 9

  // ── Paragraph 4 (bold) ───────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  const p4 = 'Failure to comply with this request will result in a formal complaint to the Connecticut Department of Insurance.'
  const lines4 = doc.splitTextToSize(p4, maxW)
  doc.text(lines4, margin, y)

  // ── Download ─────────────────────────────────────────────────────
  const lastName = (ro.ownerName || 'customer').trim().split(/\s+/).pop()
  doc.save(`${lastName}_prestorage.pdf`)

  return storageStart
}

// ── Required fields check ────────────────────────────────────────────────────
function getMissingFields(ro) {
  const missing = []
  if (!ro?.ownerName?.trim())       missing.push('ownerName')
  if (!ro?.vehicleYear?.trim() && !ro?.vehicleMake?.trim()) missing.push('vehicle')
  if (!ro?.insuranceCompany?.trim()) missing.push('insuranceCompany')
  if (!ro?.claimNumber?.trim())      missing.push('claimNumber')
  return missing
}

const FIELD_LABELS = {
  ownerName:        'Customer Name',
  vehicle:          'Year & Make',
  insuranceCompany: 'Insurance Company',
  claimNumber:      'Claim #',
}

// ── Pre-Storage Modal ────────────────────────────────────────────────────────
function PreStorageModal({ open, onClose, ro: initialRo }) {
  const queryClient = useQueryClient()
  const [ro, setRo] = useState(initialRo)
  const [forwardToTotal, setForwardToTotal] = useState(false)
  const [activated, setActivated] = useState(false)

  // Inline edit form for missing fields
  const [editForm, setEditForm] = useState({
    ownerName:        initialRo?.ownerName        || '',
    vehicleYear:      initialRo?.vehicleYear       || '',
    vehicleMake:      initialRo?.vehicleMake       || '',
    vehicleModel:     initialRo?.vehicleModel      || '',
    insuranceCompany: initialRo?.insuranceCompany  || '',
    claimNumber:      initialRo?.claimNumber       || '',
  })

  // Reset when opened for a new RO
  useEffect(() => {
    if (open) {
      setRo(initialRo)
      setActivated(false)
      setForwardToTotal(false)
      setEditForm({
        ownerName:        initialRo?.ownerName        || '',
        vehicleYear:      initialRo?.vehicleYear       || '',
        vehicleMake:      initialRo?.vehicleMake       || '',
        vehicleModel:     initialRo?.vehicleModel      || '',
        insuranceCompany: initialRo?.insuranceCompany  || '',
        claimNumber:      initialRo?.claimNumber       || '',
      })
    }
  }, [open, initialRo])

  const missingFields = getMissingFields(ro)
  const hasMissing = missingFields.length > 0

  const today = new Date()
  const storageStart = addBusinessDays(today, 2)

  // Save missing fields back to the RO
  const saveMutation = useMutation({
    mutationFn: (data) => rosApi.update(ro.id, data),
    onSuccess: (updated) => {
      // Merge saved data back so modal shows correct values
      setRo((prev) => ({ ...prev, ...updated }))
      queryClient.invalidateQueries({ queryKey: ['supplements-all'] })
      queryClient.invalidateQueries({ queryKey: ['ros'] })
      toast.success('RO updated')
    },
    onError: (err) => toast.error(err.message || 'Failed to save'),
  })

  const handleSaveFields = () => {
    // Validate the fields being entered
    if (!editForm.ownerName.trim())       { toast.error('Customer name is required'); return }
    if (!editForm.vehicleYear.trim() && !editForm.vehicleMake.trim()) {
      toast.error('Year and Make are required'); return
    }
    if (!editForm.insuranceCompany.trim()) { toast.error('Insurance company is required'); return }
    if (!editForm.claimNumber.trim())      { toast.error('Claim number is required'); return }

    saveMutation.mutate({
      ownerName:        editForm.ownerName.trim()        || null,
      vehicleYear:      editForm.vehicleYear.trim()       || null,
      vehicleMake:      editForm.vehicleMake.trim()       || null,
      vehicleModel:     editForm.vehicleModel.trim()      || null,
      insuranceCompany: editForm.insuranceCompany.trim()  || null,
      claimNumber:      editForm.claimNumber.trim()       || null,
    })
  }

  const activateMutation = useMutation({
    mutationFn: (data) => prestorageApi.activate(ro.id, data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['production'] })
      queryClient.invalidateQueries({ queryKey: ['supplements-all'] })
      setActivated(true)
      toast.success(res.totalJobId
        ? 'Pre-storage activated + job created in Towne Total ✓'
        : 'Pre-storage activated on Board ✓')
    },
    onError: (err) => toast.error(err.message || 'Failed to activate pre-storage'),
  })

  const handleDownloadPDF = () => {
    generatePrestoragePDF(ro)
    toast.success('PDF downloaded')
  }

  const handleActivate = () => {
    activateMutation.mutate({
      storageStartDate: storageStart.toISOString(),
      forwardToTotal,
    })
  }

  const vehicle = [ro?.vehicleYear, ro?.vehicleMake, ro?.vehicleModel].filter(Boolean).join(' ')
  const setField = (k) => (e) => setEditForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <Modal open={open} onClose={onClose} title="Generate Pre-Storage Letter">
      <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-0.5">

        {/* ── Missing fields alert ─────────────────────────────────── */}
        {hasMissing && (
          <div className="bg-red-950/40 border border-red-500/40 rounded-xl p-3 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-400 shrink-0" />
              <p className="text-sm font-bold text-red-300">Required information missing</p>
            </div>
            <p className="text-xs text-red-400/80">
              The following fields are required to generate the letter. Fill them in below and save to the RO.
            </p>

            {/* Missing field indicators */}
            <div className="flex flex-wrap gap-1.5">
              {missingFields.map((f) => (
                <span key={f} className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300">
                  {FIELD_LABELS[f]}
                </span>
              ))}
            </div>

            {/* Inline edit inputs */}
            <div className="space-y-2 pt-1">
              {missingFields.includes('ownerName') && (
                <Input
                  label="Customer Name *"
                  value={editForm.ownerName}
                  onChange={setField('ownerName')}
                  placeholder="Jane Smith"
                  autoFocus
                />
              )}
              {missingFields.includes('vehicle') && (
                <div className="grid grid-cols-3 gap-2">
                  <Input label="Year *"  value={editForm.vehicleYear}  onChange={setField('vehicleYear')}  placeholder="2022" />
                  <Input label="Make *"  value={editForm.vehicleMake}  onChange={setField('vehicleMake')}  placeholder="Toyota" />
                  <Input label="Model"   value={editForm.vehicleModel} onChange={setField('vehicleModel')} placeholder="Camry" />
                </div>
              )}
              {missingFields.includes('insuranceCompany') && (
                <Input
                  label="Insurance Company *"
                  value={editForm.insuranceCompany}
                  onChange={setField('insuranceCompany')}
                  placeholder="State Farm"
                />
              )}
              {missingFields.includes('claimNumber') && (
                <Input
                  label="Claim # *"
                  value={editForm.claimNumber}
                  onChange={setField('claimNumber')}
                  placeholder="CLM-00123"
                />
              )}
            </div>

            <Button
              variant="primary"
              loading={saveMutation.isPending}
              onClick={handleSaveFields}
              className="w-full flex items-center justify-center gap-2"
            >
              <Save size={14} />
              Save to RO & Continue
            </Button>
          </div>
        )}

        {/* ── Info preview (shown once all fields are present) ─────── */}
        {!hasMissing && (
          <>
            <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-3 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Customer</span>
                <span className="text-gray-200 font-semibold">{ro?.ownerName}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Vehicle</span>
                <span className="text-gray-200 font-semibold">{vehicle}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Insurance</span>
                <span className="text-gray-200 font-semibold">{ro?.insuranceCompany}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Claim #</span>
                <span className="text-gray-200 font-mono">{ro?.claimNumber}</span>
              </div>
              <div className="border-t border-gray-700/50 pt-1.5 mt-1.5 flex justify-between text-xs">
                <span className="text-gray-500">Letter date</span>
                <span className="text-gray-100 font-semibold">{fmtFullDate(today)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Storage starts</span>
                <span className="text-amber-300 font-bold">{fmtFullDate(storageStart)}</span>
              </div>
            </div>

            {/* Download button */}
            <Button
              variant="primary"
              onClick={handleDownloadPDF}
              className="w-full flex items-center justify-center gap-2"
            >
              <Download size={15} />
              Download PDF — {(ro?.ownerName || 'customer').trim().split(/\s+/).pop()}_prestorage.pdf
            </Button>

            {/* Divider */}
            <div className="relative flex items-center gap-3">
              <div className="flex-1 border-t border-gray-700/50" />
              <span className="text-[10px] text-gray-600 font-bold uppercase tracking-widest shrink-0">Optional</span>
              <div className="flex-1 border-t border-gray-700/50" />
            </div>

            {/* Forward to Total toggle */}
            <button
              onClick={() => setForwardToTotal(!forwardToTotal)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-sm ${
                forwardToTotal
                  ? 'bg-blue-600/15 border-blue-500/40 text-blue-300'
                  : 'bg-gray-800/60 border-gray-700/50 text-gray-400 hover:text-gray-200'
              }`}
            >
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                forwardToTotal ? 'bg-blue-500 border-blue-400' : 'border-gray-600'
              }`}>
                {forwardToTotal && <Check size={10} className="text-white" />}
              </div>
              <div className="text-left">
                <p className="font-semibold leading-tight">Forward to Towne Total</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Creates a pre-storage job with $125/$175 daily rates</p>
              </div>
              <Send size={14} className="ml-auto shrink-0" />
            </button>

            {/* Activate pre-storage button */}
            {!activated ? (
              <Button
                variant="secondary"
                loading={activateMutation.isPending}
                onClick={handleActivate}
                className="w-full flex items-center justify-center gap-2"
              >
                <Warehouse size={15} />
                Activate Pre-Storage on Board
              </Button>
            ) : (
              <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm font-bold">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Pre-Storage Accruing
              </div>
            )}
          </>
        )}

        <Button variant="ghost" onClick={onClose} className="w-full">
          Close
        </Button>
      </div>
    </Modal>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function Supplements() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [prestorageRO, setPrestorageRO] = useState(null)

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
                : 'bg-gray-800 border-gray-600 text-gray-300 hover:text-white hover:border-gray-500'
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
              className="bg-gray-800/70 border border-gray-700/60 rounded-2xl overflow-hidden"
            >
              {/* RO header row */}
              <div className="border-b border-gray-700/60">
                <button
                  onClick={() => ro?.id && navigate(`/ros/${ro.id}`)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/40 transition-colors group"
                >
                  <div className="text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-gray-100 font-mono">RO #{roNumber}</span>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        {items.length} supplement{items.length !== 1 ? 's' : ''}
                      </span>
                      {ro?.prestorageActive && (
                        <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300">
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          Pre-Storage
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap mt-0.5">
                      {ro?.insuranceCompany && (
                        <span className="text-xs text-gray-300">{ro.insuranceCompany}</span>
                      )}
                      {ro?.ownerName && (
                        <span className="text-xs text-gray-400">{ro.ownerName}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-gray-500 group-hover:text-gray-200 transition-colors shrink-0" />
                </button>

                {/* Pre-Storage action row */}
                {ro && (
                  <div className="px-4 pb-2.5 flex items-center justify-between">
                    <span className="text-[10px] text-gray-600">
                      {ro.prestorageActive && ro.prestorageStartDate
                        ? `Storage accruing since ${fmtDate(ro.prestorageStartDate)}`
                        : 'No pre-storage active'}
                    </span>
                    <button
                      onClick={() => setPrestorageRO(ro)}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-orange-400 hover:text-orange-300 transition-colors px-2 py-1 rounded-lg hover:bg-orange-500/10"
                    >
                      <FileText size={12} />
                      Generate Pre-Storage
                    </button>
                  </div>
                )}
              </div>

              {/* Supplement entries */}
              <div className="divide-y divide-gray-700/50">
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
                            <p className="text-xs text-gray-400 italic mt-0.5 truncate">{s.notes}</p>
                          )}
                          <p className="text-[10px] text-gray-500 mt-0.5">{fmtDate(s.createdAt)}</p>
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
                                : 'border-gray-600/60 text-gray-400 hover:bg-emerald-500/5 hover:text-emerald-400 hover:border-emerald-500/30'
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
                                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-200 transition-colors"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteId(s.id)}
                              className="p-2 rounded-xl text-gray-500 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors"
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

      {/* Pre-Storage Modal */}
      <AnimatePresence>
        {prestorageRO && (
          <PreStorageModal
            key={prestorageRO.id}
            open={!!prestorageRO}
            ro={prestorageRO}
            onClose={() => setPrestorageRO(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
