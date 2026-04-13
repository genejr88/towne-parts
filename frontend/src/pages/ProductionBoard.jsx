import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion'
import { ChevronLeft, ChevronRight, Car, AlertCircle, Check, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import { productionApi } from '@/lib/api'
import { STAGES, formatDate } from '@/lib/utils'
import PartsBadge from '@/components/ui/PartsBadge'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import Textarea from '@/components/ui/Textarea'

// Card background based on parts status
function cardBg(partsStatus) {
  if (partsStatus === 'missing') return 'from-red-950/60 to-gray-900'
  if (partsStatus === 'acknowledged') return 'from-amber-950/40 to-gray-900'
  if (partsStatus === 'all_here') return 'from-emerald-950/40 to-gray-900'
  return 'from-gray-800 to-gray-900'
}

function StageButton({ stage, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150 border ${
        active
          ? 'bg-blue-600 text-white border-blue-500'
          : 'bg-gray-800/70 text-gray-400 border-gray-700/50 hover:text-gray-200 hover:border-gray-600 active:bg-gray-700'
      }`}
    >
      {stage}
    </button>
  )
}

export default function ProductionBoard() {
  const queryClient = useQueryClient()
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(0) // -1 prev, 1 next
  const [localEdits, setLocalEdits] = useState({}) // { [roId]: { stage, statusNote, finalSupplement, supplementNote } }
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const saveTimeout = useRef(null)

  const { data: ros, isLoading } = useQuery({
    queryKey: ['production'],
    queryFn: productionApi.list,
    refetchInterval: 60_000,
  })

  const mutation = useMutation({
    mutationFn: ({ roId, data }) => productionApi.save(roId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production'] })
      setSaving(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (err) => {
      setSaving(false)
      toast.error(err.message || 'Failed to save')
    },
  })

  const activeROs = ros?.filter((r) => !r.archived) || []
  const currentRO = activeROs[index]

  // Get the current state for this RO (local edit or server data)
  const getState = (ro) => {
    const local = localEdits[ro?.id] || {}
    return {
      stage: local.stage ?? ro?.stage ?? 'Unassigned',
      statusNote: local.statusNote ?? ro?.statusNote ?? '',
      finalSupplement: local.finalSupplement ?? ro?.finalSupplement ?? false,
      supplementNote: local.supplementNote ?? ro?.supplementNote ?? '',
    }
  }

  // Auto-save with debounce
  const scheduleSave = useCallback((roId, data) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    setSaving(true)
    setSaved(false)
    saveTimeout.current = setTimeout(() => {
      mutation.mutate({ roId, data })
    }, 1200)
  }, [mutation])

  const updateField = (field, value) => {
    if (!currentRO) return
    const roId = currentRO.id
    const newEdits = {
      ...localEdits,
      [roId]: { ...getState(currentRO), ...localEdits[roId], [field]: value },
    }
    setLocalEdits(newEdits)
    scheduleSave(roId, { ...getState(currentRO), ...localEdits[roId], [field]: value })
  }

  // Save current card before navigating
  const saveAndNavigate = (newIndex) => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current)
      if (currentRO) {
        const state = { ...getState(currentRO), ...localEdits[currentRO.id] }
        mutation.mutate({ roId: currentRO.id, data: state })
      }
    }
    const dir = newIndex > index ? 1 : -1
    setDirection(dir)
    setIndex(newIndex)
  }

  const goPrev = () => {
    if (index > 0) saveAndNavigate(index - 1)
  }

  const goNext = () => {
    if (index < activeROs.length - 1) saveAndNavigate(index + 1)
  }

  // Swipe gesture handling
  const startX = useRef(null)
  const handleTouchStart = (e) => {
    startX.current = e.touches[0].clientX
  }
  const handleTouchEnd = (e) => {
    if (startX.current == null) return
    const dx = e.changedTouches[0].clientX - startX.current
    if (Math.abs(dx) > 60) {
      if (dx < 0) goNext()
      else goPrev()
    }
    startX.current = null
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  if (activeROs.length === 0) {
    return (
      <div className="px-4 py-8">
        <EmptyState
          icon={Car}
          title="No active ROs"
          description="All repair orders are archived or none exist yet"
        />
      </div>
    )
  }

  const ro = currentRO
  const state = getState(ro)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Counter + save status */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-b border-gray-800/60 shrink-0">
        <span className="text-sm font-medium text-gray-400">
          {index + 1} <span className="text-gray-600">of</span> {activeROs.length}
        </span>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          {saving && (
            <>
              <Spinner size="sm" />
              <span>Saving...</span>
            </>
          )}
          {!saving && saved && (
            <>
              <Check size={13} className="text-emerald-400" />
              <span className="text-emerald-400">Saved</span>
            </>
          )}
          {!saving && !saved && <span>Auto-saves</span>}
        </div>
      </div>

      {/* Card area — takes remaining space */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={ro.id}
            custom={direction}
            initial={{ opacity: 0, x: direction * 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -direction * 60 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* Main card */}
            <div className={`bg-gradient-to-b ${cardBg(ro.partsStatus)} border border-gray-700/50 rounded-2xl p-5 mb-4`}>
              {/* RO header */}
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-xl font-bold text-gray-100 font-mono">{ro.roNumber}</h2>
                    <PartsBadge status={ro.partsStatus} />
                  </div>
                  <p className="text-sm text-gray-400">
                    {[ro.vehicleYear, ro.vehicleMake, ro.vehicleModel, ro.color].filter(Boolean).join(' ')}
                  </p>
                  {ro.vendor?.name && (
                    <p className="text-xs text-gray-500 mt-0.5">{ro.vendor.name}</p>
                  )}
                </div>
                {ro.finalSupplement && (
                  <div className="bg-amber-500/15 border border-amber-500/30 rounded-xl px-3 py-1.5">
                    <p className="text-xs font-semibold text-amber-400 flex items-center gap-1">
                      <FileText size={12} /> Final Supp.
                    </p>
                  </div>
                )}
              </div>

              {/* Parts summary */}
              {ro.parts && ro.parts.length > 0 && (
                <div className="bg-gray-900/60 rounded-xl p-3 mb-4 text-xs">
                  <div className="flex gap-4 text-center">
                    <div>
                      <p className="text-gray-500">Total</p>
                      <p className="text-gray-200 font-bold text-base">{ro.parts.length}</p>
                    </div>
                    <div>
                      <p className="text-emerald-500">Received</p>
                      <p className="text-emerald-400 font-bold text-base">
                        {ro.parts.filter((p) => p.received).length}
                      </p>
                    </div>
                    <div>
                      <p className="text-red-500">Pending</p>
                      <p className="text-red-400 font-bold text-base">
                        {ro.parts.filter((p) => !p.received).length}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Stage selector */}
            <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-4 mb-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Stage</p>
              <div className="flex flex-wrap gap-2">
                {STAGES.map((s) => (
                  <StageButton
                    key={s}
                    stage={s}
                    active={state.stage === s}
                    onClick={() => updateField('stage', s)}
                  />
                ))}
              </div>
            </div>

            {/* Status note */}
            <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-4 mb-3">
              <Textarea
                label="Status Note"
                value={state.statusNote}
                onChange={(e) => updateField('statusNote', e.target.value)}
                rows={3}
                placeholder="Add a note about current status..."
                className="bg-gray-900/60"
              />
            </div>

            {/* Final supplement toggle */}
            <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-4 mb-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => updateField('finalSupplement', !state.finalSupplement)}
                  className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex items-center ${
                    state.finalSupplement ? 'bg-amber-500' : 'bg-gray-700'
                  }`}
                >
                  <motion.div
                    animate={{ x: state.finalSupplement ? 24 : 2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className="w-5 h-5 bg-white rounded-full shadow-md absolute"
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-200">Final Supplement</p>
                  <p className="text-xs text-gray-500">Toggle if this RO has a final supplement pending</p>
                </div>
              </label>

              <AnimatePresence>
                {state.finalSupplement && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 overflow-hidden"
                  >
                    <Textarea
                      label="Supplement Note"
                      value={state.supplementNote}
                      onChange={(e) => updateField('supplementNote', e.target.value)}
                      rows={2}
                      placeholder="Supplement details..."
                      className="bg-gray-900/60"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Prev / Next navigation — fixed at bottom above bottom nav */}
      <div className="shrink-0 bg-gray-950 border-t border-gray-800/60 px-4 py-3 pb-safe flex gap-3">
        <button
          onClick={goPrev}
          disabled={index === 0}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 font-semibold text-sm disabled:opacity-30 disabled:pointer-events-none active:bg-gray-700 transition-colors"
        >
          <ChevronLeft size={20} />
          Prev
        </button>
        <button
          onClick={goNext}
          disabled={index >= activeROs.length - 1}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-blue-600 border border-blue-500 text-white font-semibold text-sm disabled:opacity-30 disabled:pointer-events-none active:bg-blue-700 transition-colors"
        >
          Next
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  )
}
