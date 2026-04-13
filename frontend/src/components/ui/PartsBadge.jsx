import Badge from './Badge'

const STATUS_MAP = {
  MISSING: { label: 'Parts Missing', variant: 'red' },
  ACKNOWLEDGED: { label: 'Acknowledged', variant: 'yellow' },
  ALL_HERE: { label: 'All Here', variant: 'green' },
}

export default function PartsBadge({ status, className }) {
  const s = STATUS_MAP[status] || { label: status || 'Unknown', variant: 'gray' }
  return <Badge variant={s.variant} dot className={className}>{s.label}</Badge>
}
