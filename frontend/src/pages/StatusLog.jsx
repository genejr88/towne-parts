import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Activity, ArrowLeft, Calendar, ChevronRight, Wrench, Clock, RefreshCw } from 'lucide-react'
import { productionApi } from '@/lib/api'
import { STAGE_COLORS, formatTimeAgo } from '@/lib/utils'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'

// Day-of-week + nice label for a YYYY-MM-DD key
function dayHeader(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((today - date) / 86_400_000)

  let relative
  if (diffDays === 0)      relative = 'Today'
  else if (diffDays === 1) relative = 'Yesterday'
  else if (diffDays < 7)   relative = `${diffDays} days ago`
  else                     relative = null

  const long = date.toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  })
  return { relative, long }
}

export default function StatusLog() {
  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['production-status-log'],
    queryFn: () => productionApi.statusLog(14),
    refetchInterval: 30_000,           // live update every 30s
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })

  const days = data?.days || []
  const nonEmptyDays = useMemo(() => days.filter(d => d.updates.length > 0), [days])
  const totalUpdates = nonEmptyDays.reduce((s, d) => s + d.updates.length, 0)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <Link to="/board" className="p-2 -ml-2 rounded-xl text-gray-400 hover:text-gray-100 hover:bg-gray-800/60 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-extrabold text-gray-100 flex items-center gap-2">
            <Activity size={18} className="text-blue-400" /> Status Log
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Daily production status — live updates from the board
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-400 hover:text-gray-100 bg-gray-800/60 border border-gray-700/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          {isFetching ? 'Updating' : 'Refresh'}
        </button>
      </div>

      {/* Live indicator */}
      <div className="flex items-center gap-2 ml-10 mb-5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-60 animate-ping" />
          <span className="relative rounded-full h-1.5 w-1.5 bg-emerald-400" />
        </span>
        <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-emerald-400">
          Live · refreshes every 30s
        </p>
        <span className="text-[10px] text-gray-600 ml-auto">
          {totalUpdates} entr{totalUpdates !== 1 ? 'ies' : 'y'} across {nonEmptyDays.length} day{nonEmptyDays.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Daily timeline */}
      {nonEmptyDays.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No status notes yet"
          description="As you update RO statuses on the Production Board, daily snapshots will appear here."
        />
      ) : (
        <div className="space-y-7">
          {nonEmptyDays.map((day, dayIdx) => {
            const { relative, long } = dayHeader(day.date)
            const freshCount = day.updates.filter(u => !u.isStale).length
            return (
              <motion.section
                key={day.date}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(dayIdx * 0.04, 0.3) }}
              >
                {/* Day header */}
                <div className="flex items-baseline gap-2 mb-2 pl-1">
                  <Calendar size={12} className="text-gray-600 self-center" />
                  {relative && (
                    <span className="text-sm font-extrabold text-gray-100">{relative}</span>
                  )}
                  <span className="text-xs text-gray-500">{long}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wider font-semibold text-gray-600">
                    {freshCount > 0 && (
                      <span className="text-emerald-400 mr-2">{freshCount} updated</span>
                    )}
                    {day.updates.length} total
                  </span>
                </div>

                {/* RO entries for this day */}
                <div className="space-y-2">
                  {day.updates.map((u) => (
                    <UpdateRow key={`${day.date}-${u.roId}`} update={u} />
                  ))}
                </div>
              </motion.section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function UpdateRow({ update: u }) {
  const stageColor = STAGE_COLORS[u.stage] || 'bg-gray-700/50 text-gray-400'
  const vehicle = [u.vehicleYear, u.vehicleMake, u.vehicleModel].filter(Boolean).join(' ')

  return (
    <Link
      to={`/ros/${u.roId}`}
      className={`block rounded-xl border transition-all ${
        u.isStale
          ? 'border-gray-800/60 bg-gray-900/30 hover:border-gray-700/80'
          : 'border-gray-700/60 bg-gray-900/70 hover:border-blue-500/40 hover:bg-gray-900'
      }`}
    >
      <div className="px-4 py-3">
        {/* Top row: RO# / vehicle / owner / stage */}
        <div className="flex items-start gap-3 mb-1.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className={`font-extrabold text-sm tracking-tight ${u.isStale ? 'text-gray-400' : 'text-gray-100'}`}>
                RO {u.roNumber || '—'}
              </p>
              {vehicle && (
                <p className={`text-xs ${u.isStale ? 'text-gray-600' : 'text-gray-400'} truncate`}>
                  {vehicle}
                </p>
              )}
            </div>
            {u.ownerName && (
              <p className={`text-[11px] mt-0.5 truncate ${u.isStale ? 'text-gray-600' : 'text-gray-500'}`}>
                {u.ownerName}{u.insuranceCompany ? ` · ${u.insuranceCompany}` : ''}
              </p>
            )}
          </div>
          {u.stage && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap ${stageColor} ${u.isStale ? 'opacity-60' : ''}`}>
              {u.stage}
            </span>
          )}
          <ChevronRight size={14} className="text-gray-700 mt-0.5 flex-shrink-0" />
        </div>

        {/* Status note — the headline */}
        {u.statusNote && (
          <p className={`text-sm leading-snug ${u.isStale ? 'text-gray-500' : 'text-gray-200'}`}>
            {u.statusNote}
          </p>
        )}

        {/* Waiting parts / next step — secondary lines */}
        {(u.waitingParts || u.nextStep) && (
          <div className={`mt-1.5 flex flex-col gap-0.5 text-[11px] ${u.isStale ? 'text-gray-600' : 'text-gray-500'}`}>
            {u.waitingParts && (
              <p><span className="font-semibold text-gray-500 uppercase tracking-wide">Waiting:</span> {u.waitingParts}</p>
            )}
            {u.nextStep && (
              <p><span className="font-semibold text-gray-500 uppercase tracking-wide">Next:</span> {u.nextStep}</p>
            )}
          </div>
        )}

        {/* Footer: tech + timestamp + stale indicator */}
        <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-600">
          {u.tech && (
            <span className="flex items-center gap-1">
              <Wrench size={10} /> {u.tech}
            </span>
          )}
          {u.updatedAt && (
            <span className="flex items-center gap-1">
              <Clock size={10} /> {formatTimeAgo(u.updatedAt)}
              {u.updatedBy ? ` · ${u.updatedBy}` : ''}
            </span>
          )}
          {u.isStale && (
            <span className="ml-auto flex items-center gap-1 text-amber-600/80 font-semibold uppercase tracking-wider">
              No change
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
