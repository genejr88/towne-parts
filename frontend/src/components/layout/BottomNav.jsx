import { Link, useLocation } from 'react-router-dom'
import { PackageCheck, Layers, RotateCcw, Settings, Package } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/ros', icon: PackageCheck, label: 'Parts' },
  { to: '/board', icon: Layers, label: 'Board' },
  { to: '/src', icon: RotateCcw, label: 'S.R.C.' },
  { to: '/inventory', icon: Package, label: 'Inventory' },
  { to: '/admin', icon: Settings, label: 'Admin' },
]

export default function BottomNav() {
  const location = useLocation()
  const { isAdmin } = useAuth()

  const items = isAdmin
    ? navItems
    : navItems.filter((n) => n.to !== '/admin')

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-gray-950 border-t border-gray-800/80 safe-area-bottom">
      <div className="flex items-stretch">
        {items.map(({ to, icon: Icon, label }) => {
          // Active if pathname starts with the nav item's path
          const active = location.pathname === to || location.pathname.startsWith(to + '/')
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-1 py-2.5 px-1 transition-all duration-200 select-none',
                active
                  ? 'text-blue-400'
                  : 'text-gray-500 hover:text-gray-300 active:text-gray-200'
              )}
            >
              <div
                className={cn(
                  'p-1.5 rounded-xl transition-all duration-200',
                  active ? 'bg-blue-500/15' : 'bg-transparent'
                )}
              >
                <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
              </div>
              <span className={cn('text-[10px] font-semibold leading-none', active ? 'text-blue-400' : 'text-gray-500')}>
                {label}
              </span>
            </Link>
          )
        })}
      </div>
      {/* iOS safe area spacer */}
      <div className="h-safe-area-inset-bottom" />
    </nav>
  )
}
