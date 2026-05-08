/**
 * Connect API — read-only RO data for Towne Connect (customer messaging app)
 * Protected by a shared secret key in the Authorization header.
 * Returns customer info only — no parts data.
 */
const express = require('express')
const prisma  = require('../lib/prisma')

const router = express.Router()

function requireConnectKey(req, res, next) {
  const apiKey = process.env.CONNECT_API_KEY
  if (!apiKey) return res.status(503).json({ success: false, error: 'Connect API not configured' })

  const auth = req.headers.authorization
  if (!auth || auth !== `Bearer ${apiKey}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  next()
}

// GET /api/connect/ros?search=
router.get('/ros', requireConnectKey, async (req, res) => {
  try {
    const { search } = req.query
    const where = { isArchived: false }

    if (search?.trim()) {
      const term = search.trim()
      where.OR = [
        { roNumber: { contains: term, mode: 'insensitive' } },
        { ownerName: { contains: term, mode: 'insensitive' } },
        { ownerPhone: { contains: term } },
        { vehicleMake: { contains: term, mode: 'insensitive' } },
        { vehicleModel: { contains: term, mode: 'insensitive' } },
      ]
    }

    const ros = await prisma.rO.findMany({
      where,
      select: {
        id: true,
        roNumber: true,
        ownerName: true,
        ownerPhone: true,
        ownerEmail: true,
        vehicleYear: true,
        vehicleMake: true,
        vehicleModel: true,
        vehicleColor: true,
        productionStage: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })

    res.json({ success: true, data: ros })
  } catch (err) {
    console.error('Connect ROS error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
