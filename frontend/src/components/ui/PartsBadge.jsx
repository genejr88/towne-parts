import Badge from './Badge'

const STATUS_MAP = {
  missing: { label: 'Parts Missing', variant: 'red' },
  acknowledged: { label: 'Acknowledged', variant: 'yellow' },
  all_here: { label: 'All Here', variant: 'green' },
}

export default function PartsBadge({ status, className }) {
  const s = STATUS_MAP[status] || { label: status || 'Unknown', variant: 'gray' }
  return <Badge variant={s.variant} dot className={className}>{s.label}</Badge>
}
