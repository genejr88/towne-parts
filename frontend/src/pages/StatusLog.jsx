import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity, ArrowLeft, Calendar, ChevronRight, Wrench, Clock, RefreshCw,
  Package, ListTodo, CheckSquare, User, X, Car,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { productionApi, tasksApi } from '@/lib/api'
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

const SORT_OPTIONS = [
  { key: 'date',  label: 'Date Modified' },
  { key: 'ro',    label: 'RO #' },
  { key: 'phase', label: 'Phase' },
  { key: 'parts', label: 'Parts Here' },
  { key: 'make',  label: 'Make' },
]

function sortUpdates(updates, sortKey) {
  const arr = [...updates]
  switch (sortKey) {
    case 'ro':
      return arr.sort((a, b) => (a.roNumber || '').localeCompare(b.roNumber || '', undefined, { numeric: true }))
    case 'phase':
      return arr.sort((a, b) => (a.stage || 'zzzz').localeCompare(b.stage || 'zzzz'))
    case 'parts':
      return arr.sort((a, b) => {
        const aHere = a.partsStatus === 'ALL_HERE' ? 0 : 1
        const bHere = b.partsStatus === 'ALL_HERE' ? 0 : 1
        if (aHere !== bHere) return aHere - bHere
        return (a.roNumber || '').localeCompare(b.roNumber || '', undefined, { numeric: true })
      })
    case 'make':
      return arr.sort((a, b) => (a.vehicleMake || '').localeCompare(b.vehicleMake || ''))
    case 'date':
    default:
      return arr.sort((a, b) => {
        if (a.isStale !== b.isStale) return a.isStale ? 1 : -1
        if (a.updatedAt && b.updatedAt) return new Date(b.updatedAt) - new Date(a.updatedAt)
        return (a.roNumber || '').localeCompare(b.roNumber || '')
      })
  }
}

// ── Tasks Modal ───────────────────────────────────────────────────────────────
function TasksModal({ open, onClose }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['all-tasks-pending'],
    queryFn: () => tasksApi.list({ status: 'PENDING' }),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
    staleTime: 5_000,
  })

  const doneMutation = useMutation({
    mutationFn: (id) => tasksApi.complete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-tasks-pending'] })
      queryClient.invalidateQueries({ queryKey: ['production'] })
      toast.success('Task marked done')
    },
    onError: (err) => toast.error(err.message || 'Failed'),
  })

  const removeMutation = useMutation({
    mutationFn: (id) => tasksApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-tasks-pending'] })
      queryClient.invalidateQueries({ queryKey: ['production'] })
    },
    onError: (err) => toast.error(err.message || 'Failed'),
  })

  // Group tasks by assignedTo
  const grouped = useMemo(() => {
    if (!tasks?.length) return []
    const map = new Map()
    for (const task of tasks) {
      const name = task.assignedTo
      if (!map.has(name)) map.set(name, [])
      map.get(name).push(task)
    }
    // Sort alphabetically by name
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [tasks])

  const handleGoToRO = (task) => {
    onClose()
    navigate(`/ros/${task.ro?.id}`)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 35 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-700/60 rounded-t-2xl max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800/60 shrink-0">
              <div className="flex items-center gap-2.5">
                <ListTodo size={18} className="text-orange-400" />
                <h2 className="text-base font-bold text-gray-100">Open Tasks</h2>
                {tasks && tasks.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 text-xs font-bold border border-orange-500/30">
                    {tasks.length}
                  </span>
                )}
              </div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1">
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {isLoading && (
                <div className="flex justify-center py-12"><Spinner size="lg" /></div>
              )}

              {!isLoading && grouped.length === 0 && (
                <div className="flex flex-col items-center py-16 gap-3 text-gray-600">
                  <CheckSquare size={36} className="opacity-30" />
                  <p className="text-sm font-medium">No open tasks — all clear!</p>
                </div>
              )}

              {grouped.length > 0 && (
                <div className="space-y-6">
                  {grouped.map(([name, personTasks]) => (
                    <div key={name}>
                      {/* Person header */}
                      <div className="flex items-center gap-2 mb-2.5">
                        <div className="w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center shrink-0">
                          <User size={13} className="text-orange-400" />
                        </div>
                        <span className="text-sm font-extrabold text-orange-300">{name}</span>
                        <span className="text-xs font-semibold text-gray-600">
                          {personTasks.length} task{personTasks.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Tasks for this person */}
                      <div className="space-y-2 pl-9">
                        {personTasks.map((task) => {
                          const vehicle = [task.ro?.vehicleYear, task.ro?.vehicleMake, task.ro?.vehicleModel].filter(Boolean).join(' ')
                          return (
                            <div
                              key={task.id}
                              className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden"
                            >
                              {/* RO context row */}
                              <button
                                onClick={() => handleGoToRO(task)}
                                className="w-full text-left px-3.5 pt-3 pb-1.5 hover:bg-gray-700/30 transition-colors"
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-black text-gray-100 font-mono">
                                    RO {task.ro?.roNumber || '—'}
                                  </span>
                                  {vehicle && (
                                    <span className="text-xs text-gray-500 flex items-center gap-1">
                                      <Car size={9} /> {vehicle}
                                    </span>
                                  )}
                                  {task.ro?.ownerName && (
                                    <span className="text-[11px] text-gray-600">{task.ro.ownerName}</span>
                                  )}
                                  <ChevronRight size={12} className="text-gray-700 ml-auto" />
                                </div>
                              </button>

                              {/* Task note */}
                              <div className="px-3.5 pb-3">
                                <p className="text-sm text-gray-200 leading-snug mb-2">{task.note}</p>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-gray-600 flex items-center gap-1">
                                    <Clock size={9} />
                                    {formatTimeAgo(task.createdAt)}
                                    {task.createdBy ? ` · by ${task.createdBy}` : ''}
                                  </span>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => doneMutation.mutate(task.id)}
                                      disabled={doneMutation.isPending}
                                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
                                    >
                                      <CheckSquare size={10} /> Done
                                    </button>
                                    <button
                                      onClick={() => removeMutation.mutate(task.id)}
                                      disabled={removeMutation.isPending}
                                      className="p-1 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                                    >
                                      <X size={12} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function StatusLog() {
  const [sortKey, setSortKey] = useState('date')
  const [tasksOpen, setTasksOpen] = useState(false)

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['production-status-log'],
    queryFn: () => productionApi.statusLog(14),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })

  // Pending task count for the badge
  const { data: pendingTasks } = useQuery({
    queryKey: ['all-tasks-pending'],
    queryFn: () => tasksApi.list({ status: 'PENDING' }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
  const pendingCount = pendingTasks?.length || 0

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

        {/* Tasks button */}
        <button
          onClick={() => setTasksOpen(true)}
          className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            pendingCount > 0
              ? 'text-orange-300 bg-orange-950/40 border-orange-900/50 hover:bg-orange-950/60'
              : 'text-gray-400 bg-gray-800/60 border-gray-700/50 hover:text-gray-100'
          }`}
        >
          <ListTodo size={13} />
          Tasks
          {pendingCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-orange-500 text-white text-[9px] font-black flex items-center justify-center shadow-md">
              {pendingCount > 9 ? '9+' : pendingCount}
            </span>
          )}
        </button>

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
      <div className="flex items-center gap-2 ml-10 mb-4">
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

      {/* Sort controls */}
      <div className="flex items-center gap-1.5 flex-wrap mb-5">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-600 mr-0.5">Sort:</span>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => setSortKey(opt.key)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
              sortKey === opt.key
                ? 'bg-blue-600 border-blue-500 text-white shadow-sm shadow-blue-900/40'
                : 'bg-gray-800/60 border-gray-700/50 text-gray-400 hover:text-gray-200 hover:border-gray-600'
            }`}
          >
            {opt.key === 'parts' && <Package size={10} className="inline mr-1 -mt-px" />}
            {opt.label}
          </button>
        ))}
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
            const sorted = sortUpdates(day.updates, sortKey)
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
                  {sorted.map((u) => (
                    <UpdateRow key={`${day.date}-${u.roId}`} update={u} />
                  ))}
                </div>
              </motion.section>
            )
          })}
        </div>
      )}

      {/* Tasks modal */}
      <TasksModal open={tasksOpen} onClose={() => setTasksOpen(false)} />
    </div>
  )
}

function UpdateRow({ update: u }) {
  const stageColor = STAGE_COLORS[u.stage] || 'bg-gray-700/50 text-gray-400'
  const vehicle = [u.vehicleYear, u.vehicleMake, u.vehicleModel].filter(Boolean).join(' ')
  const partsHere = u.partsStatus === 'ALL_HERE'

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
              {partsHere && (
                <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${u.isStale ? 'bg-emerald-900/20 text-emerald-700' : 'bg-emerald-900/40 text-emerald-400'}`}>
                  <Package size={8} /> All Here
                </span>
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

        {/* Status note */}
        {u.statusNote && (
          <p className={`text-sm leading-snug ${u.isStale ? 'text-gray-500' : 'text-gray-200'}`}>
            {u.statusNote}
          </p>
        )}

        {/* Waiting parts / next step */}
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

        {/* Footer */}
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
