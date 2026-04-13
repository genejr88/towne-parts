const express = require('express')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

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
          select: { id: true, isReceived: true, finishStatus: true },
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
