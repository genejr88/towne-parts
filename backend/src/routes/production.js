const express = require('express')
const axios = require('axios')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const TOTALS_URL = process.env.TOTALS_API_URL || 'https://totals.towneapps.com'
const TOTALS_USER = process.env.TOTALS_USERNAME || 'gene'
const TOTALS_PASS = process.env.TOTALS_PASSWORD || 'TowneRental1'

async function getTotalsToken() {
  const res = await axios.post(`${TOTALS_URL}/api/auth/login`, {
    username: TOTALS_USER,
    password: TOTALS_PASS,
  })
  return res.data.data?.token
}

async function createTotalsJob(ro) {
  const token = await getTotalsToken()
  const today = new Date().toISOString()
  const nameParts = (ro.ownerName || '').trim().split(/\s+/)
  const firstName = nameParts[0] || null
  const lastName = nameParts.slice(1).join(' ') || null

  const res = await axios.post(
    `${TOTALS_URL}/api/jobs`,
    {
      firstName,
      lastName,
      dateIn: today,
      dateOut: today,
      year: ro.vehicleYear || null,
      make: ro.vehicleMake || null,
      model: ro.vehicleModel || null,
      color: ro.vehicleColor || null,
      insuranceCompany: ro.insuranceCompany || null,
      claimNumber: ro.claimNumber || null,
      roNumber: ro.roNumber || null,
      chargeStorage: false,
      charges: [],
    },
    { headers: { Authorization: `Bearer ${token}` } }
  )
  return res.data.data?.id
}

async function createPrestorageTotalsJob(ro, storageStartDate) {
  const token = await getTotalsToken()
  const dateIn = storageStartDate ? new Date(storageStartDate).toISOString() : new Date().toISOString()
  const nameParts = (ro.ownerName || '').trim().split(/\s+/)
  const firstName = nameParts[0] || null
  const lastName = nameParts.slice(1).join(' ') || null

  const res = await axios.post(
    `${TOTALS_URL}/api/jobs`,
    {
      firstName,
      lastName,
      dateIn,
      dateOut: dateIn,  // same day; user updates dateOut in Towne Total when car leaves
      year: ro.vehicleYear || null,
      make: ro.vehicleMake || null,
      model: ro.vehicleModel || null,
      color: ro.vehicleColor || null,
      insuranceCompany: ro.insuranceCompany || null,
      claimNumber: ro.claimNumber || null,
      roNumber: ro.roNumber || null,
      notes: `Pre-Storage — Pending Supplement (RO ${ro.roNumber})`,
      chargeStorage: true,
      storageRateFirstCustom: 125,
      storageRateAfterCustom: 175,
      charges: [],
    },
    { headers: { Authorization: `Bearer ${token}` } }
  )
  return res.data.data?.id
}

const router = express.Router()

// GET /api/production
// Returns all non-archived ROs with production data, sorted by productionUpdatedAt (nulls last)
router.get('/', requireAuth, async (req, res) => {
  try {
    const ros = await prisma.rO.findMany({
      where: { isArchived: false },
      include: {
        vendor: true,
        parts: {
          select: { id: true, isReceived: true, finishStatus: true, description: true, partNumber: true },
        },
        locationPhotos: {
          take: 1,
          orderBy: { createdAt: 'asc' },
          select: { id: true, storedPath: true },
        },
        _count: { select: { srcEntries: true } },
        supplements: {
          select: { id: true, number: true, status: true },
          orderBy: { number: 'asc' },
        },
      },
      orderBy: [
        { productionUpdatedAt: { sort: 'desc', nulls: 'last' } },
        { updatedAt: 'desc' },
      ],
    })

    return res.json({ success: true, data: ros })
  } catch (err) {
    console.error('Get production board error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/production/activity — today's production activity log
router.get('/activity', requireAuth, async (req, res) => {
  try {
    const { date } = req.query
    const day = date ? new Date(date) : new Date()
    const start = new Date(day)
    start.setHours(0, 0, 0, 0)
    const end = new Date(day)
    end.setHours(23, 59, 59, 999)

    const logs = await prisma.activityLog.findMany({
      where: {
        createdAt: { gte: start, lte: end },
      },
      include: {
        ro: { select: { id: true, roNumber: true, vehicleYear: true, vehicleMake: true, vehicleModel: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return res.json({ success: true, data: logs })
  } catch (err) {
    console.error('Get production activity error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/production/parts-activity — parts check-in activity feed, grouped by date
router.get('/parts-activity', requireAuth, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 2, 30)
    const since = new Date()
    since.setDate(since.getDate() - (days - 1))
    since.setHours(0, 0, 0, 0)

    const logs = await prisma.activityLog.findMany({
      where: {
        createdAt: { gte: since },
        eventType: { in: ['PART_STATUS_CHANGED', 'PARTS_BULK_RECEIVED'] },
        NOT: { message: { contains: 'not received' } },
      },
      include: {
        ro: {
          select: {
            id: true,
            roNumber: true,
            vehicleYear: true,
            vehicleMake: true,
            vehicleModel: true,
            ownerName: true,
            partsStatus: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return res.json({ success: true, data: logs })
  } catch (err) {
    console.error('Get parts activity error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/production/:roId — save production stage/notes for an RO
router.post('/:roId', requireAuth, async (req, res) => {
  const roId = parseInt(req.params.roId)
  const {
    productionStage,
    productionStatusNote,
    productionWaitingParts,
    productionNextStep,
    productionFinalSupplement,
    productionSupplementNote,
    isTotalLoss,
    totalLossReleased,
    prestorageActive,
    assignedTech,
  } = req.body

  try {
    const existing = await prisma.rO.findUnique({ where: { id: roId } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    const updateData = {
      productionUpdatedAt: new Date(),
    }

    if (productionStage !== undefined) updateData.productionStage = productionStage
    if (productionStatusNote !== undefined) updateData.productionStatusNote = productionStatusNote
    if (productionWaitingParts !== undefined) updateData.productionWaitingParts = productionWaitingParts
    if (productionNextStep !== undefined) updateData.productionNextStep = productionNextStep
    if (productionFinalSupplement !== undefined) updateData.productionFinalSupplement = Boolean(productionFinalSupplement)
    if (productionSupplementNote !== undefined) updateData.productionSupplementNote = productionSupplementNote
    if (isTotalLoss !== undefined) updateData.isTotalLoss = Boolean(isTotalLoss)
    if (totalLossReleased !== undefined) updateData.totalLossReleased = Boolean(totalLossReleased)
    if (prestorageActive !== undefined) updateData.prestorageActive = Boolean(prestorageActive)
    if (assignedTech !== undefined) updateData.assignedTech = assignedTech || null

    // Auto-create totals job when flagged total loss for the first time
    const becomingTotalLoss = Boolean(isTotalLoss) && !existing.isTotalLoss
    if (becomingTotalLoss && !existing.totalLossJobId) {
      try {
        const jobId = await createTotalsJob(existing)
        if (jobId) updateData.totalLossJobId = jobId
      } catch (e) {
        console.error('Failed to create totals job:', e.message)
        // Non-fatal — board update still goes through
      }
    }

    const ro = await prisma.rO.update({
      where: { id: roId },
      data: updateData,
      include: {
        vendor: true,
        parts: { select: { id: true, isReceived: true, finishStatus: true } },
      },
    })

    // Snapshot a ProductionStatusUpdate when any of the key notes/stage/tech actually changed
    const norm = (v) => (v == null ? '' : String(v).trim())
    const noteChanged   = productionStatusNote   !== undefined && norm(productionStatusNote)   !== norm(existing.productionStatusNote)
    const waitChanged   = productionWaitingParts !== undefined && norm(productionWaitingParts) !== norm(existing.productionWaitingParts)
    const nextChanged   = productionNextStep     !== undefined && norm(productionNextStep)     !== norm(existing.productionNextStep)
    const stageChanged  = productionStage        !== undefined && norm(productionStage)        !== norm(existing.productionStage)
    const techChanged   = assignedTech           !== undefined && norm(assignedTech)           !== norm(existing.assignedTech)

    if (noteChanged || waitChanged || nextChanged || stageChanged || techChanged) {
      try {
        await prisma.productionStatusUpdate.create({
          data: {
            roId,
            statusNote:   norm(ro.productionStatusNote)   || null,
            waitingParts: norm(ro.productionWaitingParts) || null,
            nextStep:     norm(ro.productionNextStep)     || null,
            stage:        norm(ro.productionStage)        || null,
            tech:         norm(ro.assignedTech)           || null,
            createdBy:    req.user?.username || null,
          },
        })
      } catch (e) {
        // Snapshot is best-effort — never fail the save
        console.error('Status snapshot failed:', e.message)
      }
    }

    // Log activity
    const stageLabel = updateData.productionStage || existing.productionStage || 'unknown'
    await prisma.activityLog.create({
      data: {
        roId,
        eventType: 'PRODUCTION_UPDATED',
        message: `Production stage updated to "${stageLabel}" by ${req.user.username}`,
      },
    })

    return res.json({ success: true, data: ro })
  } catch (err) {
    console.error('Update production error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/production/status-log?days=14
// Returns active ROs grouped by day, each day showing every RO's status as of
// end-of-day. If there's no snapshot on that day, the most recent prior snapshot
// is carried forward and flagged as stale.
router.get('/status-log', requireAuth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 14, 1), 60)

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const earliest = new Date(today)
    earliest.setDate(earliest.getDate() - (days - 1))

    // All active ROs
    const ros = await prisma.rO.findMany({
      where: { isArchived: false },
      select: {
        id: true,
        roNumber: true,
        vehicleYear: true,
        vehicleMake: true,
        vehicleModel: true,
        ownerName: true,
        productionStage: true,
        productionStatusNote: true,
        productionWaitingParts: true,
        productionNextStep: true,
        productionUpdatedAt: true,
        assignedTech: true,
        insuranceCompany: true,
        partsStatus: true,
      },
    })

    // Pull all snapshots in-window for those ROs (single query, indexed by [roId, createdAt])
    const snapshots = await prisma.productionStatusUpdate.findMany({
      where: { roId: { in: ros.map(r => r.id) } },
      orderBy: { createdAt: 'asc' },
    })

    // Index snapshots by roId for fast lookup
    const byRo = new Map()
    for (const s of snapshots) {
      if (!byRo.has(s.roId)) byRo.set(s.roId, [])
      byRo.get(s.roId).push(s)
    }

    // Build day buckets — newest day first
    const dayBuckets = []
    for (let i = 0; i < days; i++) {
      const dayStart = new Date(today)
      dayStart.setDate(dayStart.getDate() - i)
      const dayEnd = new Date(dayStart)
      dayEnd.setHours(23, 59, 59, 999)
      dayBuckets.push({ dayStart, dayEnd, dayKey: dayStart.toISOString().slice(0, 10), updates: [] })
    }

    // For every (RO, day) compute the latest snapshot at-or-before end-of-day
    for (const ro of ros) {
      const list = byRo.get(ro.id) || []
      for (const bucket of dayBuckets) {
        // Last snapshot with createdAt <= dayEnd
        let latest = null
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].createdAt <= bucket.dayEnd) { latest = list[i]; break }
        }

        // Source of truth — fall back to the live RO record if no snapshots yet
        const source = latest || {
          statusNote: ro.productionStatusNote,
          waitingParts: ro.productionWaitingParts,
          nextStep: ro.productionNextStep,
          stage: ro.productionStage,
          tech: ro.assignedTech,
          createdAt: ro.productionUpdatedAt || null,
          createdBy: null,
        }

        // Stale if the source is older than the start of this bucket
        const isStale = source.createdAt
          ? new Date(source.createdAt) < bucket.dayStart
          : true

        // Skip if there's no information at all to display
        const hasContent = source.statusNote || source.waitingParts || source.nextStep || source.stage
        if (!hasContent) continue

        bucket.updates.push({
          roId: ro.id,
          roNumber: ro.roNumber,
          vehicleYear: ro.vehicleYear,
          vehicleMake: ro.vehicleMake,
          vehicleModel: ro.vehicleModel,
          ownerName: ro.ownerName,
          insuranceCompany: ro.insuranceCompany,
          partsStatus: ro.partsStatus || null,
          statusNote: source.statusNote || null,
          waitingParts: source.waitingParts || null,
          nextStep: source.nextStep || null,
          stage: source.stage || null,
          tech: source.tech || null,
          updatedAt: source.createdAt,
          updatedBy: source.createdBy || null,
          isStale,
        })
      }
    }

    // Sort each day: fresh updates first (not stale), then by RO number
    for (const bucket of dayBuckets) {
      bucket.updates.sort((a, b) => {
        if (a.isStale !== b.isStale) return a.isStale ? 1 : -1
        // Then newest update first within the same staleness band
        if (a.updatedAt && b.updatedAt) return new Date(b.updatedAt) - new Date(a.updatedAt)
        return (a.roNumber || '').localeCompare(b.roNumber || '')
      })
    }

    return res.json({
      success: true,
      data: {
        days: dayBuckets.map(b => ({
          date: b.dayKey,
          updates: b.updates,
        })),
      },
    })
  } catch (err) {
    console.error('Get status log error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/production/prestorage/:roId
// Activate pre-storage on an RO and optionally create a job in Towne Total
router.post('/prestorage/:roId', requireAuth, async (req, res) => {
  const roId = parseInt(req.params.roId)
  const { storageStartDate, forwardToTotal } = req.body

  try {
    const existing = await prisma.rO.findUnique({ where: { id: roId } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    const updateData = {
      prestorageActive: true,
      prestorageLetterDate: new Date(),
      prestorageStartDate: storageStartDate ? new Date(storageStartDate) : null,
      productionUpdatedAt: new Date(),
    }

    let totalJobId = null
    if (forwardToTotal) {
      try {
        totalJobId = await createPrestorageTotalsJob(existing, storageStartDate)
        if (totalJobId) updateData.prestorageJobId = totalJobId
      } catch (e) {
        console.error('Failed to create prestorage totals job:', e.message)
        // Non-fatal — board update still goes through
      }
    }

    const ro = await prisma.rO.update({
      where: { id: roId },
      data: updateData,
      include: {
        vendor: true,
        parts: { select: { id: true, isReceived: true, finishStatus: true } },
        supplements: { select: { id: true, number: true, status: true } },
      },
    })

    await prisma.activityLog.create({
      data: {
        roId,
        eventType: 'PRODUCTION_UPDATED',
        message: `Pre-storage activated on RO ${existing.roNumber}${totalJobId ? ' — job created in Towne Total' : ''}`,
      },
    })

    return res.json({ success: true, data: ro, totalJobId })
  } catch (err) {
    console.error('Activate prestorage error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
