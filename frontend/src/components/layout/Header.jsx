import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Package, ChevronDown, LogOut, User } from 'lucide-react'
import { useAuth } from '@/lib/auth'

export default function Header() {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-gray-700/50 bg-gray-950/90 backdrop-blur-xl">
        <div className="flex items-center justify-between px-4 h-14">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
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

      {/* Click outside to close */}
      {userMenuOpen && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setUserMenuOpen(false)}
        />
      )}
    </>
  )
}
