import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

const Select = forwardRef(function Select({ className, label, error, children, ...props }, ref) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <select
        ref={ref}
        className={cn(
          'w-full rounded-xl border bg-gray-900/60 px-4 py-3 text-sm text-gray-100',
          'border-gray-700/60 focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20',
          'outline-none transition-all duration-200 cursor-pointer',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'min-h-[44px]',
          error && 'border-red-500/60',
          className
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
})

export default Select
