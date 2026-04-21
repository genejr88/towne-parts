import { useEffect, useState } from 'react'
import { RotateCcw, Package, Building2, CalendarDays, FileText, RefreshCw } from 'lucide-react'
import { srcApi } from '@/lib/api'

function TypeBadge({ type }) {
  const label = type === 'CORE_RETURN' ? 'Core Return' : 'Return'
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/20">
      {label}
    </span>
  )
}

export default function PublicReturns() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [error, setError] = useState(null)

  async function fetchEntries() {
    try {
      const res = await fetch(srcApi.publicListUrl())
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setEntries(json.data)
      setLastUpdated(new Date())
      setError(null)
    } catch (e) {
      setError('Failed to load returns.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEntries()
    const interval = setInterval(fetchEntries, 30_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-5">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                <RotateCcw size={20} className="text-orange-400" />
                Active Returns
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">Towne Body Shop · Awaiting Credit</p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </div>
              {lastUpdated && (
                <p className="text-xs text-gray-600 mt-1">
                  Updated {lastUpdated.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <RefreshCw size={28} className="animate-spin text-gray-600" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-red-400">{error}</p>
            <button onClick={fetchEntries} className="mt-4 text-sm text-blue-400 underline">
              Retry
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-20">
            <RotateCcw size={40} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 font-semibold">No pending returns</p>
            <p className="text-gray-600 text-sm mt-1">All credits received!</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-600 uppercase tracking-wider font-semibold mb-4">
              {entries.length} open return{entries.length !== 1 ? 's' : ''}
            </p>
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="bg-gray-900 border border-gray-800 rounded-2xl p-4"
              >
                {/* Top row */}
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <TypeBadge type={entry.entryType} />
                      {entry.ro?.roNumber && (
                        <span className="text-xs font-mono font-semibold text-gray-300 bg-gray-800 px-2 py-0.5 rounded-full">
                          RO {entry.ro.roNumber}
                        </span>
                      )}
                    </div>

                    {entry.ro && (
                      <p className="text-xs text-gray-500 mb-2">
                        {[entry.ro.vehicleYear, entry.ro.vehicleMake, entry.ro.vehicleModel].filter(Boolean).join(' ')}
                      </p>
                    )}

                    <div className="space-y-1.5">
                      {entry.partNumber && (
                        <div className="flex items-center gap-2 text-sm">
                          <Package size={13} className="text-gray-600 shrink-0" />
                          <span className="font-mono text-gray-300">{entry.partNumber}</span>
                        </div>
                      )}
                      {entry.partDescription && (
                        <div className="flex items-center gap-2 text-sm">
                          <FileText size={13} className="text-gray-600 shrink-0" />
                          <span className="text-gray-300">{entry.partDescription}</span>
                        </div>
                      )}
                      {entry.vendorName && (
                        <div className="flex items-center gap-2 text-sm">
                          <Building2 size={13} className="text-gray-600 shrink-0" />
                          <span className="text-gray-400">{entry.vendorName}</span>
                        </div>
                      )}
                      {entry.returnDate && (
                        <div className="flex items-center gap-2 text-sm">
                          <CalendarDays size={13} className="text-gray-600 shrink-0" />
                          <span className="text-gray-500">
                            {new Date(entry.returnDate).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>

                    {entry.note && (
                      <p className="text-sm text-gray-400 mt-2 pl-0.5">{entry.note}</p>
                    )}
                  </div>
                </div>

                {/* Photos */}
                {entry.photos?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-800">
                    {entry.photos.map((photo) => (
                      <a
                        key={photo.id}
                        href={srcApi.photoUrl(photo.storedPath)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={srcApi.photoUrl(photo.storedPath)}
                          alt="Invoice"
                          className="w-20 h-20 object-cover rounded-xl border border-gray-700 hover:border-orange-500 transition-colors"
                          onError={(e) => {
                            e.target.style.display = 'none'
                          }}
                        />
                      </a>
                    ))}
                  </div>
                )}

                <p className="text-xs text-gray-700 mt-3">
                  Created {new Date(entry.createdAt).toLocaleDateString()}
                  {entry.createdBy ? ` by ${entry.createdBy}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-center py-8 text-xs text-gray-700">
        Towne Body Shop · Parts Management
      </div>
    </div>
  )
}
