import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function Modal({ open, onClose, title, children, footer, className, size = 'md' }) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Prevent body scroll when modal open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // Use full class strings so Tailwind includes them in the build
  const smMaxW =
    size === 'sm' ? 'sm:max-w-sm'
    : size === 'lg' ? 'sm:max-w-2xl'
    : size === 'xl' ? 'sm:max-w-4xl'
    : 'sm:max-w-md'

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />

          {/*
            Positioning wrapper — bottom-aligned on mobile, centered on desktop.
            Using flex centering instead of CSS translate so Framer Motion's
            y-transform doesn't conflict with any centering transform.
          */}
          <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 32 }}
              className={cn(
                'pointer-events-auto w-full',
                'bg-gray-900 border border-gray-700/60 shadow-2xl',
                'rounded-t-2xl max-h-[90dvh] flex flex-col',
                'sm:rounded-2xl',
                smMaxW,
                className
              )}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/50 shrink-0">
                {/* Drag handle for mobile */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-gray-600 rounded-full sm:hidden" />
                <h2 className="text-base font-semibold text-gray-100">{title}</h2>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-700/60 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="overflow-y-auto p-5 flex-1 min-h-0">
                {children}
              </div>

              {/* Optional pinned footer */}
              {footer && (
                <div className="shrink-0 px-5 py-4 border-t border-gray-700/50">
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
