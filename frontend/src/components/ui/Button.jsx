import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'

const variants = {
  primary: 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-glow-sm border border-blue-500/30',
  secondary: 'bg-gray-700/80 hover:bg-gray-600/80 active:bg-gray-800 text-gray-100 border border-gray-600/50',
  danger: 'bg-red-600/90 hover:bg-red-500 active:bg-red-700 text-white border border-red-500/30',
  success: 'bg-emerald-600/90 hover:bg-emerald-500 active:bg-emerald-700 text-white border border-emerald-500/30',
  ghost: 'bg-transparent hover:bg-gray-700/50 active:bg-gray-700 text-gray-300 hover:text-gray-100',
  outline: 'bg-transparent border border-blue-500/50 text-blue-400 hover:bg-blue-500/10 hover:border-blue-400 active:bg-blue-500/20',
  warning: 'bg-amber-600/90 hover:bg-amber-500 active:bg-amber-700 text-white border border-amber-500/30',
}

const sizes = {
  xs: 'px-2.5 py-1.5 text-xs rounded-lg',
  sm: 'px-3 py-2 text-sm rounded-lg',
  md: 'px-4 py-2.5 text-sm rounded-xl',
  lg: 'px-5 py-3.5 text-base rounded-xl',
  xl: 'px-6 py-4 text-lg rounded-2xl',
  icon: 'p-2.5 rounded-xl',
  'icon-sm': 'p-1.5 rounded-lg',
}

const Button = forwardRef(function Button(
  { className, variant = 'primary', size = 'md', disabled, loading, children, ...props },
  ref
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 cursor-pointer select-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </motion.button>
  )
})

export default Button
