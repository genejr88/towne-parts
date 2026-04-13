import { cn } from '@/lib/utils'

const variants = {
  red: 'bg-red-500/15 text-red-400 border border-red-500/30',
  yellow: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  green: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  blue: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  purple: 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  orange: 'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  gray: 'bg-gray-500/15 text-gray-400 border border-gray-500/30',
  default: 'bg-gray-700/60 text-gray-300 border border-gray-600/40',
}

export default function Badge({ children, variant = 'default', className, dot = false }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold leading-none whitespace-nowrap',
        variants[variant] || variants.default,
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0',
            variant === 'red' && 'bg-red-400',
            variant === 'yellow' && 'bg-amber-400',
            variant === 'green' && 'bg-emerald-400',
            variant === 'blue' && 'bg-blue-400',
            variant === 'purple' && 'bg-purple-400',
            variant === 'orange' && 'bg-orange-400',
            variant === 'gray' && 'bg-gray-400',
            !['red','yellow','green','blue','purple','orange','gray'].includes(variant) && 'bg-gray-400',
          )}
        />
      )}
      {children}
    </span>
  )
}
