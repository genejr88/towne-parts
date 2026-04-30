const express = require('express')
const router  = express.Router()
const prisma  = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)

// ── GET /api/carriers ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const carriers = await prisma.carrierProfile.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count:    { select: { filingLogs: true } },
        filingLogs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
    res.json({ success: true, data: carriers })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── GET /api/carriers/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const carrier = await prisma.carrierProfile.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        filingLogs: {
          orderBy: { createdAt: 'desc' },
          include: {
            supplement: {
              select: {
                id: true, number: true,
                ro: { select: { id: true, roNumber: true, ownerName: true } },
              },
            },
          },
        },
      },
    })
    if (!carrier) return res.status(404).json({ success: false, error: 'Not found' })
    res.json({ success: true, data: carrier })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── PUT /api/carriers/:id ─────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { contactName, contactEmail, contactPhone, contactFax, portalUrl, preferredMethod, notes } = req.body
    const data = {}
    if (contactName     !== undefined) data.contactName     = contactName     || null
    if (contactEmail    !== undefined) data.contactEmail    = contactEmail    || null
    if (contactPhone    !== undefined) data.contactPhone    = contactPhone    || null
    if (contactFax      !== undefined) data.contactFax      = contactFax      || null
    if (portalUrl       !== undefined) data.portalUrl       = portalUrl       || null
    if (preferredMethod !== undefined) data.preferredMethod = preferredMethod || null
    if (notes           !== undefined) data.notes           = notes           || null

    const carrier = await prisma.carrierProfile.update({
      where: { id: parseInt(req.params.id) },
      data,
    })
    res.json({ success: true, data: carrier })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
