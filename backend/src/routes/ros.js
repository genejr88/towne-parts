const express = require('express')
const prisma = require('../lib/prisma')
const { requireAuth, requireAdmin } = require('../middleware/auth')

const router = express.Router()

// Shared include for full RO detail
const RO_DETAIL_INCLUDE = {
  vendor: true,
  parts: {
    include: { photos: true },
    orderBy: { createdAt: 'asc' },
  },
  invoices: { orderBy: { createdAt: 'desc' } },
  srcEntries: { orderBy: { createdAt: 'desc' } },
  activityLog: { orderBy: { createdAt: 'desc' } },
}

// GET /api/ros
// Query: search, archived (bool string), partsStatus
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search, archived, partsStatus } = req.query

    const where = {}

    // Archived filter — default to non-archived
    if (archived === 'true') {
      where.isArchived = true
    } else {
      where.isArchived = false
    }

    if (partsStatus) {
      where.partsStatus = partsStatus
    }

    if (search && search.trim()) {
      const s = search.trim()
      where.OR = [
        { roNumber: { contains: s, mode: 'insensitive' } },
        { vehicleMake: { contains: s, mode: 'insensitive' } },
        { vehicleModel: { contains: s, mode: 'insensitive' } },
        { vehicleColor: { contains: s, mode: 'insensitive' } },
        { vin: { contains: s, mode: 'insensitive' } },
        { vendor: { name: { contains: s, mode: 'insensitive' } } },
        { parts: { some: { partNumber: { contains: s, mode: 'insensitive' } } } },
        { parts: { some: { description: { contains: s, mode: 'insensitive' } } } },
      ]
    }

    const ros = await prisma.rO.findMany({
      where,
      include: {
        vendor: true,
        parts: { select: { id: true, isReceived: true } },
        _count: { select: { parts: true, invoices: true, srcEntries: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    return res.json({ success: true, data: ros })
  } catch (err) {
    console.error('Get ROs error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/ros
router.post('/', requireAuth, async (req, res) => {
  const {
    roNumber,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    vehicleColor,
    vin,
    vendorId,
  } = req.body

  if (!roNumber) {
    return res.status(400).json({ success: false, error: 'RO number is required.' })
  }

  try {
    const existing = await prisma.rO.findUnique({ where: { roNumber } })
    if (existing) {
      return res.status(409).json({ success: false, error: 'An RO with that number already exists.' })
    }

    const ro = await prisma.rO.create({
      data: {
        roNumber,
        vehicleYear: vehicleYear || null,
        vehicleMake: vehicleMake || null,
        vehicleModel: vehicleModel || null,
        vehicleColor: vehicleColor || null,
        vin: vin || null,
        vendorId: vendorId ? parseInt(vendorId) : null,
      },
      include: { vendor: true },
    })

    // Log activity
    await prisma.activityLog.create({
      data: {
        roId: ro.id,
        eventType: 'RO_CREATED',
        message: `RO ${roNumber} created`,
      },
    })

    return res.status(201).json({ success: true, data: ro })
  } catch (err) {
    console.error('Create RO error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/ros/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const ro = await prisma.rO.findUnique({
      where: { id: parseInt(req.params.id) },
      include: RO_DETAIL_INCLUDE,
    })

    if (!ro) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    return res.json({ success: true, data: ro })
  } catch (err) {
    console.error('Get RO error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// PUT /api/ros/:id
router.put('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)
  const {
    roNumber,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    vehicleColor,
    vin,
    vendorId,
    partsStatus,
    productionStage,
    productionStatusNote,
    productionWaitingParts,
    productionNextStep,
    productionFinalSupplement,
    productionSupplementNote,
  } = req.body

  try {
    const existing = await prisma.rO.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    // Check for duplicate roNumber if changing
    if (roNumber && roNumber !== existing.roNumber) {
      const dup = await prisma.rO.findUnique({ where: { roNumber } })
      if (dup) {
        return res.status(409).json({ success: false, error: 'An RO with that number already exists.' })
      }
    }

    const updateData = {}
    if (roNumber !== undefined) updateData.roNumber = roNumber
    if (vehicleYear !== undefined) updateData.vehicleYear = vehicleYear
    if (vehicleMake !== undefined) updateData.vehicleMake = vehicleMake
    if (vehicleModel !== undefined) updateData.vehicleModel = vehicleModel
    if (vehicleColor !== undefined) updateData.vehicleColor = vehicleColor
    if (vin !== undefined) updateData.vin = vin
    if (vendorId !== undefined) updateData.vendorId = vendorId ? parseInt(vendorId) : null
    if (partsStatus !== undefined) updateData.partsStatus = partsStatus
    if (productionStage !== undefined) updateData.productionStage = productionStage
    if (productionStatusNote !== undefined) updateData.productionStatusNote = productionStatusNote
    if (productionWaitingParts !== undefined) updateData.productionWaitingParts = productionWaitingParts
    if (productionNextStep !== undefined) updateData.productionNextStep = productionNextStep
    if (productionFinalSupplement !== undefined) updateData.productionFinalSupplement = Boolean(productionFinalSupplement)
    if (productionSupplementNote !== undefined) updateData.productionSupplementNote = productionSupplementNote

    const ro = await prisma.rO.update({
      where: { id },
      data: updateData,
      include: RO_DETAIL_INCLUDE,
    })

    return res.json({ success: true, data: ro })
  } catch (err) {
    console.error('Update RO error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/ros/:id — soft delete (archive)
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const existing = await prisma.rO.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    const ro = await prisma.rO.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date() },
    })

    await prisma.activityLog.create({
      data: {
        roId: id,
        eventType: 'RO_ARCHIVED',
        message: `RO ${existing.roNumber} archived`,
      },
    })

    return res.json({ success: true, data: ro })
  } catch (err) {
    console.error('Archive RO error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/ros/:id/unarchive
router.post('/:id/unarchive', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const existing = await prisma.rO.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    const ro = await prisma.rO.update({
      where: { id },
      data: { isArchived: false, archivedAt: null },
    })

    await prisma.activityLog.create({
      data: {
        roId: id,
        eventType: 'RO_UNARCHIVED',
        message: `RO ${existing.roNumber} restored from archive`,
      },
    })

    return res.json({ success: true, data: ro })
  } catch (err) {
    console.error('Unarchive RO error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
