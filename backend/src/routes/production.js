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

module.exports = router
