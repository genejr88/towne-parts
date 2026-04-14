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
  { value: 'NEEDS_PAINT', label: 'Needs Paint', color: 'blue' },
  { value: 'PAINTED', label: 'Painted', color: 'purple' },
  { value: 'TEXTURED', label: 'Textured', color: 'orange' },
  { value: 'NO_FINISH_NEEDED', label: 'No Finish', color: 'gray' },
]

export function nextFinishStatus(current) {
  const values = FINISH_STATUSES.map((f) => f.value)
  const idx = values.indexOf(current)
  return values[(idx + 1) % values.length]
}

export const SRC_TYPES = ['Return', 'Core Return', 'Supplement', 'Other']

export function formatTimeAgo(dateStr) {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return formatDateShort(dateStr)
}

// Tailwind classes per production stage (bg + text)
export const STAGE_COLORS = {
  'Unassigned':       'bg-gray-700/50 text-gray-400',
  'Teardown':         'bg-orange-900/50 text-orange-300',
  'Check-In':         'bg-sky-900/50 text-sky-300',
  'Needs Written':    'bg-yellow-900/50 text-yellow-300',
  'Approval':         'bg-amber-900/50 text-amber-300',
  'HBM':              'bg-pink-900/50 text-pink-300',
  'Body':             'bg-orange-900/60 text-orange-400',
  'Paint Prep':       'bg-violet-900/50 text-violet-300',
  'Paint':            'bg-purple-900/60 text-purple-300',
  'Reassembly':       'bg-blue-900/50 text-blue-300',
  'Final Supplement': 'bg-red-900/50 text-red-300',
  'Detail':           'bg-teal-900/50 text-teal-300',
  'Delivery':         'bg-emerald-900/50 text-emerald-300',
  'Completed':        'bg-emerald-900/70 text-emerald-200',
}
