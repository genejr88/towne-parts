import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Package, ChevronLeft, Clock, CheckCircle2, Calendar, Layers,
} from 'lucide-react'
import { productionApi } from '@/lib/api'
import Spinner from '@/components/ui/Spinner'

// Time-range tabs — drives days param on /production/parts-activity
const RANGE_TABS = [
  { key: 1,  label: 'Today' },
  { key: 2,  label: 'Last 2 Days' },
  { key: 7,  label: 'Last Week' },
  { key: 30, label: 'Last Month' },
]

export default function RecentActivity() {
  const navigate = useNavigate()
  const [days, setDays] = useState(2)

  const { data: logs, isLoading } = useQuery({
    queryKey: ['parts-activity', days],
    queryFn: () => productionApi.partsActivity(days),
    refetchInterval: 20_000,
  })

  // Group logs by calendar date
  const grouped = useMemo(() => {
    if (!logs?.length) return []
    const map = {}
    for (const log of logs) {
      const dateKey = new Date(log.createdAt).toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric',
      })
      if (!map[dateKey]) map[dateKey] = []
      map[dateKey].push(log)
    }
    return Object.entries(map)
  }, [logs])

  const totalCount = logs?.length || 0

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header — back + title + range tabs */}
      <div className="bg-gray-950/95 backdrop-blur-sm px-4 pt-3 pb-2 sticky top-0 z-10 border-b border-gray-800/60">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 -ml-1.5 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-800/60 transition-colors"
            aria-label="Back"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Package size={17} className="text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base font-bold text-gray-100 leading-none">Recent Parts Activity</h1>
              <p className="text-[11px] text-gray-500 mt-0.5 leading-none">
                {isLoading ? 'Loading…' : `${totalCount} check-in${totalCount === 1 ? '' : 's'}`}
              </p>
            </div>
          </div>
        </div>

        {/* Range tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {RANGE_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setDays(key)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 ${
                days === key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200 active:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 max-w-2xl mx-auto w-full">
        {isLoading && (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}

        {!isLoading && grouped.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-3 py-20 text-center"
          >
            <div className="w-14 h-14 rounded-2xl bg-gray-800/60 flex items-center justify-center">
              <Package size={26} className="text-gray-600" />
            </div>
            <p className="text-gray-500 text-sm">No parts checked in for this range</p>
            <p className="text-gray-600 text-xs">Try a longer time window</p>
          </motion.div>
        )}

        {grouped.map(([date, entries], dayIdx) => (
          <motion.div
            key={date}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(dayIdx * 0.04, 0.2) }}
            className="mb-5"
          >
            <div className="flex items-center gap-2 mb-2">
              <Calendar size={11} className="text-gray-500" />
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">{date}</p>
              <span className="text-[10px] text-gray-600 ml-auto">
                {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
              </span>
            </div>

            <div className="space-y-2">
              {entries.map((log) => (
                <button
                  key={log.id}
                  onClick={() => log.ro && navigate(`/ros/${log.ro.id}`)}
                  disabled={!log.ro}
                  className="w-full text-left bg-gray-800/60 border border-gray-700/40 rounded-xl px-3.5 py-3 hover:bg-gray-700/60 active:bg-gray-700 disabled:opacity-50 disabled:hover:bg-gray-800/60 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                        {log.ro?.roNumber && (
                          <span className="text-sm font-bold text-gray-100 font-mono">
                            {log.ro.roNumber}
                          </span>
                        )}
                        {log.ro && (
                          <span className="text-xs text-gray-400 truncate">
                            {[log.ro.vehicleYear, log.ro.vehicleMake, log.ro.vehicleModel].filter(Boolean).join(' ')}
                          </span>
                        )}
                        {log.eventType === 'PARTS_BULK_RECEIVED' && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 flex items-center gap-1">
                            <Layers size={9} /> Bulk
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate pl-5">{log.message}</p>
                      {log.ro?.ownerName && (
                        <p className="text-[11px] text-gray-600 truncate pl-5 mt-0.5">{log.ro.ownerName}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-600 shrink-0 flex items-center gap-1 mt-0.5">
                      <Clock size={10} />
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
