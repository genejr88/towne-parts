import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

const Input = forwardRef(function Input({ className, label, error, icon, hint, ...props }, ref) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full rounded-xl border bg-gray-900/60 px-4 py-3 text-sm text-gray-100 placeholder-gray-500',
            'border-gray-700/60 focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20',
            'outline-none transition-all duration-200',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'min-h-[44px]',
            icon && 'pl-10',
            error && 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/20',
            className
          )}
          {...props}
        />
      </div>
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
})

export default Input
