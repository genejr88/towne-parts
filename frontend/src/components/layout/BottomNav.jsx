import { Link, useLocation } from 'react-router-dom'
import { PackageCheck, Layers, RotateCcw, Settings, Package, FilePlus } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

function BmwIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill="#111827" />
      <path d="M12 2A10 10 0 0 0 2 12h10V2z"   fill="#0065B3" />
      <path d="M12 22A10 10 0 0 0 22 12H12v10z" fill="#0065B3" />
      <path d="M22 12A10 10 0 0 0 12 2v10h10z"  fill="#f0f0f0" />
      <path d="M2 12A10 10 0 0 0 12 22V12H2z"   fill="#f0f0f0" />
      <circle cx="12" cy="12" r="10" fill="none" stroke="#111827" strokeWidth="1.5" />
      <line x1="12" y1="2"  x2="12" y2="22" stroke="#111827" strokeWidth="1" />
      <line x1="2"  y1="12" x2="22" y2="12" stroke="#111827" strokeWidth="1" />
    </svg>
  )
}

const navItems = [
  { to: '/ros',         icon: PackageCheck, label: 'Parts' },
  { to: '/board',       icon: Layers,       label: 'Board' },
  { to: '/supplements', icon: FilePlus,     label: 'Supps' },
  { to: '/src',         icon: RotateCcw,    label: 'S.R.C.' },
  { to: '/inventory',   icon: Package,      label: 'Inventory' },
  { to: '/vault',       icon: BmwIcon,      label: 'BMW' },
  { to: '/admin',       icon: Settings,     label: 'Admin' },
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
