import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Package, ChevronDown, LogOut, Lock, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { privateApi } from '@/lib/api'

export default function Header() {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  // ── Secret gate state ──────────────────────────────────────────────────────
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [pinValue, setPinValue] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinLoading, setPinLoading] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const tapCountRef = useRef(0)
  const tapTimerRef = useRef(null)
  const pinInputRef = useRef(null)

  const openPinModal = useCallback(() => {
    setPinValue('')
    setPinError('')
    setPinLoading(false)
    setShowPin(false)
    setPinModalOpen(true)
    setTimeout(() => pinInputRef.current?.focus(), 100)
  }, [])

  // Logo: 5 taps in 3 seconds
  const handleLogoTap = () => {
    tapCountRef.current += 1
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0 }, 3000)
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0
      clearTimeout(tapTimerRef.current)
      openPinModal()
    }
  }

  // Keyboard: Shift + Ctrl + Alt + P
  useEffect(() => {
    const handler = (e) => {
      if (e.shiftKey && e.ctrlKey && e.altKey && e.key === 'P') {
        e.preventDefault()
        openPinModal()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openPinModal])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handlePinSubmit = async (e) => {
    e?.preventDefault()
    if (!pinValue.trim() || pinLoading) return
    setPinLoading(true)
    setPinError('')
    try {
      await privateApi.verify(pinValue.trim())
      sessionStorage.setItem('private_pin', pinValue.trim())
      setPinModalOpen(false)
      setPinValue('')
      navigate('/bmw')
    } catch {
      setPinError('Incorrect PIN. Try again.')
      setPinValue('')
      setTimeout(() => pinInputRef.current?.focus(), 50)
    }
    setPinLoading(false)
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-gray-700/50 bg-gray-950/90 backdrop-blur-xl">
        <div className="flex items-center justify-between px-4 h-14">
          {/* Logo — tap 5× to trigger secret gate */}
          <div
            className="flex items-center gap-2.5 select-none"
            onClick={handleLogoTap}
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shadow-glow-sm">
              <Package size={16} className="text-white" />
            </div>
            <span className="font-bold text-base text-gray-100 tracking-tight">
              Towne<span className="text-blue-400">Parts</span>
            </span>
          </div>

          {/* User menu */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800/80 border border-gray-700/50 hover:bg-gray-700/80 active:bg-gray-700 transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-bold text-white">
                  {user?.name?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              <span className="text-sm font-medium text-gray-200 max-w-[80px] truncate">
                {user?.name?.split(' ')[0] || user?.username}
              </span>
              <ChevronDown size={14} className="text-gray-400 shrink-0" />
            </button>

            <AnimatePresence>
              {userMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1.5 w-52 rounded-xl bg-gray-800 border border-gray-700/60 shadow-xl py-1 z-50"
                >
                  <div className="px-3 py-2 border-b border-gray-700/50">
                    <p className="text-sm font-semibold text-gray-100">{user?.name || user?.username}</p>
                    <p className="text-xs text-gray-400 capitalize">{user?.role?.toLowerCase() || 'staff'}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-300 hover:text-red-400 hover:bg-red-500/5 transition-colors"
                  >
                    <LogOut size={15} />
                    Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Click outside to close user menu */}
      {userMenuOpen && (
        <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} />
      )}

      {/* ── PIN Gate Modal ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {pinModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
              onClick={() => setPinModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className="fixed inset-0 z-50 flex items-center justify-center px-6 pointer-events-none"
            >
              <div
                className="w-full max-w-sm bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl p-6 pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-col items-center mb-5">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-gray-700 to-gray-600 flex items-center justify-center mb-3">
                    <Lock size={22} className="text-gray-300" />
                  </div>
                  <h2 className="text-base font-bold text-gray-100">Access Required</h2>
                  <p className="text-xs text-gray-500 mt-1">Enter your PIN to continue</p>
                </div>

                <form onSubmit={handlePinSubmit} className="flex flex-col gap-3">
                  <div className="relative">
                    <input
                      ref={pinInputRef}
                      type={showPin ? 'text' : 'password'}
                      value={pinValue}
                      onChange={(e) => { setPinValue(e.target.value); setPinError('') }}
                      placeholder="PIN"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-gray-500 pr-11"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  {pinError && (
                    <p className="text-xs text-red-400 text-center">{pinError}</p>
                  )}

                  <button
                    type="submit"
                    disabled={!pinValue.trim() || pinLoading}
                    className="w-full py-3 rounded-xl bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-sm font-semibold text-gray-100 transition-colors"
                  >
                    {pinLoading ? 'Verifying…' : 'Unlock'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPinModalOpen(false)}
                    className="w-full py-2.5 text-xs text-gray-500 hover:text-gray-400 transition-colors"
                  >
                    Cancel
                  </button>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
