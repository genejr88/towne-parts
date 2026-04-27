const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)

// ── GET /api/supplements  (all, newest first) ─────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status } = req.query
    const where = status ? { status } : {}
    const supplements = await prisma.supplement.findMany({
      where,
      include: {
        ro: {
          select: {
            id: true,
            roNumber: true,
            insuranceCompany: true,
            ownerName: true,
            vehicleYear: true,
            vehicleMake: true,
            vehicleModel: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: supplements })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── GET /api/supplements/ro/:roId ─────────────────────────────────────────────
router.get('/ro/:roId', async (req, res) => {
  try {
    const supplements = await prisma.supplement.findMany({
      where: { roId: parseInt(req.params.roId) },
      orderBy: { number: 'asc' },
    })
    res.json({ success: true, data: supplements })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── POST /api/supplements/ro/:roId ────────────────────────────────────────────
router.post('/ro/:roId', async (req, res) => {
  try {
    const roId = parseInt(req.params.roId)
    const { insuranceCompany, notes } = req.body

    // Auto-assign next number for this RO
    const existing = await prisma.supplement.findMany({ where: { roId }, orderBy: { number: 'desc' }, take: 1 })
    const nextNumber = existing.length > 0 ? existing[0].number + 1 : 1

    const supplement = await prisma.supplement.create({
      data: {
        roId,
        number: nextNumber,
        status: 'REQUESTED',
        insuranceCompany: insuranceCompany || null,
        notes: notes || null,
      },
    })
    res.json({ success: true, data: supplement })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── PUT /api/supplements/:id ──────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { status, insuranceCompany, notes } = req.body
    const data = {}
    if (status           !== undefined) data.status           = status
    if (insuranceCompany !== undefined) data.insuranceCompany = insuranceCompany
    if (notes            !== undefined) data.notes            = notes

    const supplement = await prisma.supplement.update({
      where: { id: parseInt(req.params.id) },
      data,
    })
    res.json({ success: true, data: supplement })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── DELETE /api/supplements/:id ───────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await prisma.supplement.delete({ where: { id: parseInt(req.params.id) } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
