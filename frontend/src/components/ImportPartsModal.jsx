import { useState, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Upload, Trash2, Plus, Check, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { importApi, vendorsApi, rosApi, partsApi } from '@/lib/api'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Spinner from '@/components/ui/Spinner'

export default function ImportPartsModal({ open, onClose }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)

  const [step, setStep] = useState('upload') // 'upload' | 'review'
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [form, setForm] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const { data: vendors } = useQuery({
    queryKey: ['vendors'],
    queryFn: vendorsApi.list,
    enabled: open,
  })

  const handleFile = async (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setParseError('Please upload a PDF file.')
      return
    }
    setParsing(true)
    setParseError(null)
    try {
      const data = await importApi.parse(file)
      setForm({
        roNumber: data.roNumber || '',
        vehicleYear: data.vehicleYear || '',
        vehicleMake: data.vehicleMake || '',
        vehicleModel: data.vehicleModel || '',
        vin: data.vin || '',
        vendorId: '',
        parts: data.parts.map((p, i) => ({ _key: i, ...p })),
      })
      setStep('review')
    } catch (err) {
      setParseError(err.message || 'Failed to read PDF. Make sure it is a CCC ONE Parts List export.')
    } finally {
      setParsing(false)
    }
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }, [])

  const updateField = (field, val) => setForm((f) => ({ ...f, [field]: val }))

  const updatePart = (idx, field, val) =>
    setForm((f) => ({
      ...f,
      parts: f.parts.map((p, i) => (i === idx ? { ...p, [field]: val } : p)),
    }))

  const removePart = (idx) =>
    setForm((f) => ({ ...f, parts: f.parts.filter((_, i) => i !== idx) }))

  const addPart = () =>
    setForm((f) => ({
      ...f,
      parts: [...f.parts, { _key: Date.now(), description: '', partNumber: '', qty: 1, price: null }],
    }))

  const handleConfirm = async () => {
    if (!form.roNumber.trim()) { toast.error('RO number is required'); return }
    if (form.parts.length === 0) { toast.error('No parts to import'); return }

    setSubmitting(true)
    try {
      const roData = {
        roNumber: form.roNumber.trim(),
        vehicleYear: form.vehicleYear || undefined,
        vehicleMake: form.vehicleMake || undefined,
        vehicleModel: form.vehicleModel || undefined,
        vin: form.vin || undefined,
        vendorId: form.vendorId ? parseInt(form.vendorId) : undefined,
      }

      let ro
      let isNew = true

      try {
        ro = await rosApi.create(roData)
      } catch (createErr) {
        // RO already exists — find it and patch any missing fields
        const status = createErr.response?.status ?? (createErr.message?.includes('409') ? 409 : null)
        if (status === 409) {
          const list = await rosApi.list({ search: form.roNumber.trim() })
          ro = list.find((r) => r.roNumber === form.roNumber.trim()) || list[0]
          if (!ro) throw new Error('RO already exists but could not be located.')

          // Patch missing vehicle info
          const patch = {}
          if (!ro.vehicleYear  && roData.vehicleYear)  patch.vehicleYear  = roData.vehicleYear
          if (!ro.vehicleMake  && roData.vehicleMake)  patch.vehicleMake  = roData.vehicleMake
          if (!ro.vehicleModel && roData.vehicleModel) patch.vehicleModel = roData.vehicleModel
          if (!ro.vin          && roData.vin)          patch.vin          = roData.vin
          if (!ro.vendorId     && roData.vendorId)     patch.vendorId     = roData.vendorId
          if (Object.keys(patch).length > 0) {
            ro = await rosApi.update(ro.id, patch)
          }

          isNew = false
        } else {
          throw createErr
        }
      }

      // Add parts
      let partsAdded = 0
      for (const part of form.parts) {
        if (!part.description && !part.partNumber) continue
        await partsApi.create(ro.id, {
          description: part.description || part.partNumber,
          partNumber: part.partNumber || undefined,
          qty: parseInt(part.qty) || 1,
          price: part.price != null ? part.price : undefined,
        })
        partsAdded++
      }

      await queryClient.invalidateQueries({ queryKey: ['ros'] })
      toast.success(
        isNew
          ? `RO ${ro.roNumber} created with ${partsAdded} parts`
          : `Added ${partsAdded} parts to existing RO ${ro.roNumber}`
      )
      handleClose()
      navigate(`/ros/${ro.id}`)
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to import'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    if (submitting) return
    setStep('upload')
    setForm(null)
    setParseError(null)
    setParsing(false)
    setDragOver(false)
    onClose()
  }

  const reviewFooter = step === 'review' && form ? (
    <div className="flex gap-3">
      <Button
        variant="secondary"
        onClick={() => setStep('upload')}
        className="flex-1"
        disabled={submitting}
      >
        Back
      </Button>
      <Button
        variant="primary"
        onClick={handleConfirm}
        loading={submitting}
        disabled={submitting || !form.roNumber.trim() || form.parts.length === 0}
        className="flex-1"
      >
        {!submitting && <Check size={15} />}
        Import {form.parts.length} Parts
      </Button>
    </div>
  ) : null

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={step === 'upload' ? 'Import Parts Estimate' : `Review — ${form?.parts?.length ?? 0} parts found`}
      size="lg"
      footer={reviewFooter}
    >
      {/* ── Step 1: Upload ── */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !parsing && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center transition-colors select-none ${
              parsing
                ? 'border-gray-700 bg-gray-800/30 cursor-default'
                : dragOver
                ? 'border-blue-500 bg-blue-950/30 cursor-copy'
                : 'border-gray-700 hover:border-gray-500 bg-gray-800/40 cursor-pointer'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => handleFile(e.target.files[0])}
            />

            {parsing ? (
              <div className="flex flex-col items-center gap-3">
                <Spinner size="lg" />
                <p className="text-sm text-gray-400">Reading estimate…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-600/30 flex items-center justify-center">
                  <Upload size={26} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-200">Drop a CCC ONE Parts List PDF</p>
                  <p className="text-xs text-gray-500 mt-1">or tap to browse</p>
                </div>
              </div>
            )}
          </div>

          {parseError && (
            <div className="flex items-start gap-2 p-3 bg-red-950/40 border border-red-800/50 rounded-xl">
              <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{parseError}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: Review & Edit ── */}
      {step === 'review' && form && (
        <div className="space-y-4">
          {/* RO / Vehicle fields */}
          <div className="space-y-3 pb-4 border-b border-gray-800/60">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="RO Number *"
                value={form.roNumber}
                onChange={(e) => updateField('roNumber', e.target.value)}
              />
              <Select
                label="Vendor"
                value={form.vendorId}
                onChange={(e) => updateField('vendorId', e.target.value)}
              >
                <option value="">No vendor</option>
                {vendors?.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Year"
                value={form.vehicleYear}
                onChange={(e) => updateField('vehicleYear', e.target.value)}
              />
              <Input
                label="Make"
                value={form.vehicleMake}
                onChange={(e) => updateField('vehicleMake', e.target.value)}
              />
              <Input
                label="Model"
                value={form.vehicleModel}
                onChange={(e) => updateField('vehicleModel', e.target.value)}
              />
            </div>
            {form.vin && (
              <Input
                label="VIN"
                value={form.vin}
                onChange={(e) => updateField('vin', e.target.value)}
                className="font-mono text-sm"
              />
            )}
          </div>

          {/* Parts list */}
          <div className="space-y-1.5">
            {/* Column headers */}
            <div className="grid gap-2 px-3 mb-2" style={{ gridTemplateColumns: '1fr 6rem 3rem 1.75rem' }}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</p>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Part #</p>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Qty</p>
              <div />
            </div>

            {form.parts.map((part, idx) => (
              <div
                key={part._key}
                className="grid gap-2 items-center bg-gray-800/50 border border-gray-700/40 rounded-xl px-3 py-2.5"
                style={{ gridTemplateColumns: '1fr 6rem 3rem 1.75rem' }}
              >
                <input
                  value={part.description}
                  onChange={(e) => updatePart(idx, 'description', e.target.value)}
                  placeholder="Description"
                  className="bg-transparent text-sm text-gray-200 outline-none w-full min-w-0 placeholder-gray-600"
                />
                <input
                  value={part.partNumber || ''}
                  onChange={(e) => updatePart(idx, 'partNumber', e.target.value)}
                  placeholder="—"
                  className="bg-transparent text-xs text-gray-400 font-mono outline-none w-full min-w-0 placeholder-gray-700"
                />
                <input
                  type="number"
                  value={part.qty}
                  onChange={(e) => updatePart(idx, 'qty', parseInt(e.target.value) || 1)}
                  min="1"
                  className="bg-transparent text-sm text-gray-200 outline-none w-full text-center"
                />
                <button
                  onClick={() => removePart(idx)}
                  className="text-gray-700 hover:text-red-400 transition-colors flex items-center justify-center"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}

            <button
              onClick={addPart}
              className="w-full py-2.5 border border-dashed border-gray-700 rounded-xl text-sm text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors flex items-center justify-center gap-1.5 mt-1"
            >
              <Plus size={14} /> Add part
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
