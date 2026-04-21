import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { PackageX, PackageCheck, Package, Layers, RotateCcw, TrendingUp, FileWarning, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { rosApi, srcApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import Spinner from '@/components/ui/Spinner'

function StatCard({ icon: Icon, label, value, color, onClick, delay = 0 }) {
  const colorMap = {
    red: 'from-red-600/20 to-red-500/5 border-red-500/20 text-red-400',
    yellow: 'from-amber-600/20 to-amber-500/5 border-amber-500/20 text-amber-400',
    green: 'from-emerald-600/20 to-emerald-500/5 border-emerald-500/20 text-emerald-400',
    blue: 'from-blue-600/20 to-blue-500/5 border-blue-500/20 text-blue-400',
    purple: 'from-purple-600/20 to-purple-500/5 border-purple-500/20 text-purple-400',
    orange: 'from-orange-600/20 to-orange-500/5 border-orange-500/20 text-orange-400',
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      onClick={onClick}
      className={`bg-gradient-to-br ${colorMap[color] || colorMap.blue} border rounded-2xl p-4 ${onClick ? 'cursor-pointer active:scale-95 transition-transform' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{label}</p>
          <p className="text-3xl font-bold text-gray-100">{value ?? '—'}</p>
        </div>
        <div className={`p-2.5 rounded-xl bg-gray-800/50`}>
          <Icon size={22} className={colorMap[color]?.split(' ').find(c => c.startsWith('text-')) || 'text-blue-400'} />
        </div>
      </div>
    </motion.div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const { data: ros, isLoading: rosLoading } = useQuery({
    queryKey: ['ros', 'active'],
    queryFn: () => rosApi.list({ archived: false }),
  })

  const { data: srcEntries, isLoading: srcLoading } = useQuery({
    queryKey: ['src', 'open'],
    queryFn: () => srcApi.list({ status: 'open' }),
  })

  const { data: missingPartsList } = useQuery({
    queryKey: ['ros', 'missing-parts-list'],
    queryFn: () => rosApi.list({ missingPartsList: true, archived: false }),
  })

  const isLoading = rosLoading || srcLoading

  // Compute stats from ros list
  const stats = ros
    ? {
        total: ros.length,
        missing: ros.filter((r) => r.partsStatus === 'missing').length,
        acknowledged: ros.filter((r) => r.partsStatus === 'acknowledged').length,
        allHere: ros.filter((r) => r.partsStatus === 'all_here').length,
        inProduction: ros.filter((r) =>
          r.stage && r.stage !== 'Unassigned' && r.stage !== 'Completed'
        ).length,
        srcOpen: srcEntries?.length ?? 0,
      }
    : null

  const firstName = user?.name?.split(' ')[0] || user?.username || 'there'

  return (
    <div className="px-4 py-5 pb-28 max-w-lg mx-auto">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-xl font-bold text-gray-100">
          Hey, {firstName} 👋
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Here's what's happening today</p>
      </motion.div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={Package}
            label="Active ROs"
            value={stats?.total}
            color="blue"
            delay={0}
            onClick={() => navigate('/ros')}
          />
          <StatCard
            icon={PackageX}
            label="Parts Missing"
            value={stats?.missing}
            color="red"
            delay={0.05}
            onClick={() => navigate('/ros?status=missing')}
          />
          <StatCard
            icon={TrendingUp}
            label="Acknowledged"
            value={stats?.acknowledged}
            color="yellow"
            delay={0.1}
            onClick={() => navigate('/ros?status=acknowledged')}
          />
          <StatCard
            icon={PackageCheck}
            label="All Here"
            value={stats?.allHere}
            color="green"
            delay={0.15}
            onClick={() => navigate('/ros?status=all_here')}
          />
          <StatCard
            icon={Layers}
            label="In Production"
            value={stats?.inProduction}
            color="purple"
            delay={0.2}
            onClick={() => navigate('/board')}
          />
          <StatCard
            icon={RotateCcw}
            label="Open S.R.C."
            value={stats?.srcOpen}
            color="orange"
            delay={0.25}
            onClick={() => navigate('/src')}
          />
        </div>
      )}

      {/* ROs Missing Parts List */}
      {missingPartsList && missingPartsList.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.3 }}
          className="mt-6"
        >
          <div className="flex items-center gap-2 mb-3">
            <FileWarning size={16} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">
              No Parts Added
            </h2>
            <span className="ml-auto text-xs font-bold bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">
              {missingPartsList.length}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {missingPartsList.map((ro) => (
              <button
                key={ro.id}
                onClick={() => navigate(`/ros/${ro.id}`)}
                className="w-full flex items-center justify-between bg-gray-800/60 border border-amber-500/20 rounded-xl px-4 py-3 text-left active:scale-[0.98] transition-transform"
              >
                <div>
                  <p className="text-sm font-semibold text-gray-100">RO #{ro.roNumber}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[ro.vehicleYear, ro.vehicleMake, ro.vehicleModel].filter(Boolean).join(' ') || 'No vehicle info'}
                    {ro.vendor?.name ? ` · ${ro.vendor.name}` : ''}
                  </p>
                </div>
                <ChevronRight size={16} className="text-gray-500 flex-shrink-0" />
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  )
}
