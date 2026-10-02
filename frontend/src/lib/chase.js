// Parts chase — shared labels and urgency rules for the RO check-in and the Still Out board.
// Order / ETA dates are date-only values stored at UTC midnight, so they're read in UTC.

export const CHASE_STATUSES = [
  { value: 'ORDERED',       label: 'Ordered',              chip: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  { value: 'NEED_TO_ORDER', label: 'Need to order',        chip: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  { value: 'BACKORDERED',   label: 'Backordered',          chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  { value: 'PROBLEM',       label: 'Wrong / damaged',      chip: 'bg-red-500/15 text-red-300 border-red-500/30' },
  { value: 'NOT_NEEDED',    label: 'Not needed',           chip: 'bg-gray-700/40 text-gray-400 border-gray-600/40' },
]
export const chaseStatus = (value) => CHASE_STATUSES.find((s) => s.value === value) || CHASE_STATUSES[0]

const DAY = 24 * 60 * 60 * 1000
const todayUTC = () => {
  const n = new Date()
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) // local calendar day, as a UTC-midnight stamp
}
const dayStamp = (d) => {
  const x = new Date(d)
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())
}

// "10/8" — for date-only fields (ETA, ordered)
export const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }) : '')
// For real timestamps (timeline entries)
export const fmtWhen = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
// 'YYYY-MM-DD' for <input type="date">
export const dateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')

// Days since the part was ordered (falls back to when it was added to the RO)
export function daysOut(part) {
  const from = part.dateOrdered ? dayStamp(part.dateOrdered) : dayStamp(new Date(part.createdAt).toISOString().slice(0, 10))
  return Math.max(0, Math.round((todayUTC() - from) / DAY))
}

// How urgent an outstanding part is. rank: lower = more urgent (sort key).
//   late     — past its ETA, or ordered 7+ days ago with no ETA
//   order    — still needs to be ordered
//   soon     — ETA today or tomorrow
//   noeta    — ordered, no ETA yet (under a week)
//   ok       — ETA in the future
export function urgency(part) {
  if (part.chaseStatus === 'NEED_TO_ORDER') return { key: 'order', rank: 1, label: 'Order it', tone: 'violet' }
  if (part.etaDate) {
    const diff = Math.round((dayStamp(part.etaDate) - todayUTC()) / DAY)
    if (diff < 0) return { key: 'late', rank: 0, label: `${-diff} day${diff === -1 ? '' : 's'} late`, tone: 'red' }
    if (diff === 0) return { key: 'soon', rank: 2, label: 'Due today', tone: 'amber' }
    if (diff === 1) return { key: 'soon', rank: 2, label: 'Due tomorrow', tone: 'amber' }
    return { key: 'ok', rank: 4, label: `ETA ${fmtDay(part.etaDate)}`, tone: 'gray' }
  }
  const out = daysOut(part)
  if (out >= 7) return { key: 'late', rank: 0, label: `${out} days, no ETA`, tone: 'red' }
  return { key: 'noeta', rank: 3, label: 'No ETA', tone: 'gray' }
}

export const TONE = {
  red:    'bg-red-500/15 text-red-300 border-red-500/40',
  amber:  'bg-amber-500/15 text-amber-300 border-amber-500/40',
  violet: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
  gray:   'bg-gray-800 text-gray-400 border-gray-700',
}

// "1 of 2 here" for partial deliveries, else null
export const partialLabel = (part) => (!part.isReceived && part.qty > 1 && part.qtyReceived > 0 ? `${part.qtyReceived} of ${part.qty} here` : null)
