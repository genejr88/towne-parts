import { clsx } from 'clsx'

export function cn(...inputs) {
  return clsx(inputs)
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatCurrency(cents) {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

export const STAGES = [
  'Unassigned',
  'Teardown',
  'Check-In',
  'Needs Written',
  'Approval',
  'HBM',
  'Body',
  'Paint Prep',
  'Paint',
  'Reassembly',
  'Final Supplement',
  'Detail',
  'Delivery',
  'Completed',
]

export const PARTS_STATUSES = {
  missing: { label: 'Parts Missing', color: 'red' },
  acknowledged: { label: 'Acknowledged', color: 'yellow' },
  all_here: { label: 'All Here', color: 'green' },
}

export const FINISH_STATUSES = [
  { value: 'needs_paint', label: 'Needs Paint', color: 'blue' },
  { value: 'painted', label: 'Painted', color: 'purple' },
  { value: 'textured', label: 'Textured', color: 'orange' },
  { value: 'no_finish_needed', label: 'No Finish', color: 'gray' },
]

export function nextFinishStatus(current) {
  const values = FINISH_STATUSES.map((f) => f.value)
  const idx = values.indexOf(current)
  return values[(idx + 1) % values.length]
}

export const SRC_TYPES = ['Return', 'Core Return', 'Supplement', 'Other']
