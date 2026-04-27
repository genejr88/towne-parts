const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')
const PRIVATE_PIN = process.env.PRIVATE_PIN || 'TowneBMW2025'

function requirePin(req, res, next) {
  const pin = req.headers['x-private-pin'] || req.query.pin
  if (!pin || pin !== PRIVATE_PIN) {
    return res.status(403).json({ success: false, error: 'Access denied.' })
  }
  next()
}

// All BMW routes require PIN auth
router.use(requirePin)

// ── GET /api/bmw?month=1&year=2025  ──────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { month, year } = req.query
    const where = {}
    if (month) where.month = parseInt(month)
    if (year)  where.year  = parseInt(year)

    const payments = await prisma.bMWPayment.findMany({
      where,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    })
    res.json({ success: true, data: payments })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── GET /api/bmw/summary  ─────────────────────────────────────────────────────
// Returns [{month, year, invoiced, received, outstanding, count}]
router.get('/summary', async (req, res) => {
  try {
    const payments = await prisma.bMWPayment.findMany({
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    })

    const map = {}
    payments.forEach((p) => {
      const key = `${p.year}-${p.month}`
      if (!map[key]) map[key] = { month: p.month, year: p.year, invoiced: 0, received: 0, count: 0 }
      const amt = parseFloat(p.amount || 0)
      map[key].invoiced += amt
      map[key].count    += 1
      if (p.status === 'RECEIVED') map[key].received += amt
    })

    const summary = Object.values(map).map((m) => ({
      ...m,
      outstanding: m.invoiced - m.received,
      invoiced:    parseFloat(m.invoiced.toFixed(2)),
      received:    parseFloat(m.received.toFixed(2)),
      outstanding: parseFloat((m.invoiced - m.received).toFixed(2)),
    }))

    res.json({ success: true, data: summary })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── POST /api/bmw  ────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { month, year, date, lastName, bmwNumber, roNumber, amount, status, notes } = req.body
    if (!month || !year) return res.status(400).json({ success: false, error: 'month and year are required' })

    const payment = await prisma.bMWPayment.create({
      data: {
        month: parseInt(month),
        year:  parseInt(year),
        date:  date ? new Date(date) : null,
        lastName:  lastName  || null,
        bmwNumber: bmwNumber || null,
        roNumber:  roNumber  || null,
        amount:    amount != null ? parseFloat(amount) : null,
        status:    status || 'NOT_RECEIVED',
        notes:     notes  || null,
      },
    })
    res.json({ success: true, data: payment })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── PUT /api/bmw/:id  ─────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { date, lastName, bmwNumber, roNumber, amount, status, notes, month, year } = req.body
    const data = {}
    if (date      !== undefined) data.date      = date ? new Date(date) : null
    if (lastName  !== undefined) data.lastName  = lastName
    if (bmwNumber !== undefined) data.bmwNumber = bmwNumber
    if (roNumber  !== undefined) data.roNumber  = roNumber
    if (amount    !== undefined) data.amount    = amount != null ? parseFloat(amount) : null
    if (status    !== undefined) data.status    = status
    if (notes     !== undefined) data.notes     = notes
    if (month     !== undefined) data.month     = parseInt(month)
    if (year      !== undefined) data.year      = parseInt(year)

    const payment = await prisma.bMWPayment.update({
      where: { id: parseInt(req.params.id) },
      data,
    })
    res.json({ success: true, data: payment })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── DELETE /api/bmw/:id  ──────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await prisma.bMWPayment.delete({ where: { id: parseInt(req.params.id) } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── POST /api/bmw/bulk  ───────────────────────────────────────────────────────
router.post('/bulk', async (req, res) => {
  try {
    const { payments } = req.body
    if (!Array.isArray(payments)) return res.status(400).json({ success: false, error: 'payments array required' })

    const created = await prisma.bMWPayment.createMany({
      data: payments.map((p) => ({
        month:     parseInt(p.month),
        year:      parseInt(p.year),
        date:      p.date ? new Date(p.date) : null,
        lastName:  p.lastName  || null,
        bmwNumber: p.bmwNumber || null,
        roNumber:  p.roNumber  || null,
        amount:    p.amount != null ? parseFloat(p.amount) : null,
        status:    p.status || 'NOT_RECEIVED',
        notes:     p.notes  || null,
      })),
      skipDuplicates: false,
    })
    res.json({ success: true, data: { count: created.count } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
