// BMW numbers for Towne Control (towneapps.com/admin → Parts panel). Same key guard as
// routes/adminHub.js (TOWNE_ADMIN_KEY in x-towne-admin-key); off (404) when the key is unset.
// Payments come from the BMW payment tracker (brand "BMW" only), numbers from the M-number
// sequence, and active ROs from the isBmw flag.
const express = require('express')
const crypto = require('crypto')
const prisma = require('../lib/prisma')

const router = express.Router()
const sha = v => crypto.createHash('sha256').update(String(v)).digest()

router.use((req, res, next) => {
  const key = process.env.TOWNE_ADMIN_KEY
  if (!key) return res.status(404).json({ success: false, error: 'Not found' })
  if (!crypto.timingSafeEqual(sha(req.headers['x-towne-admin-key'] || ''), sha(key))) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  next()
})

const num = d => (d == null ? 0 : Number(d))

router.get('/', async (req, res) => {
  try {
    const now = new Date()
    const year = now.getFullYear()
    const where = { brand: 'BMW' }

    const [byStatus, ytd, oldestOpen, payments, seq, assignedCount, lastAssigned, activeRos] = await Promise.all([
      prisma.bMWPayment.groupBy({ by: ['status'], where, _sum: { amount: true }, _count: { _all: true } }),
      prisma.bMWPayment.groupBy({ by: ['status'], where: { ...where, year }, _sum: { amount: true }, _count: { _all: true } }),
      prisma.bMWPayment.findFirst({ where: { ...where, status: 'NOT_RECEIVED' }, orderBy: [{ year: 'asc' }, { month: 'asc' }] }),
      prisma.bMWPayment.findMany({ where, select: { year: true, month: true, amount: true, status: true } }),
      prisma.numberSequence.findUnique({ where: { program: 'BMW' } }),
      prisma.assignedNumber.count({ where: { program: 'BMW' } }),
      prisma.assignedNumber.findFirst({ where: { program: 'BMW' }, orderBy: { createdAt: 'desc' } }),
      prisma.rO.count({ where: { isBmw: true, isArchived: false } }),
    ])

    const pick = (rows, status) => {
      const r = rows.find(x => x.status === status)
      return { count: r ? r._count._all : 0, amount: r ? num(r._sum.amount) : 0 }
    }

    // Last 12 months, oldest first, split paid / unpaid
    const months = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(year, now.getMonth() - i, 1)
      months.push({ year: d.getFullYear(), month: d.getMonth() + 1, received: 0, outstanding: 0 })
    }
    for (const p of payments) {
      const m = months.find(x => x.year === p.year && x.month === p.month)
      if (!m) continue
      if (p.status === 'RECEIVED') m.received += num(p.amount)
      else m.outstanding += num(p.amount)
    }

    res.json({ success: true, data: {
      outstanding: pick(byStatus, 'NOT_RECEIVED'),
      received: pick(byStatus, 'RECEIVED'),
      ytd: { year, received: pick(ytd, 'RECEIVED'), outstanding: pick(ytd, 'NOT_RECEIVED') },
      oldestOutstanding: oldestOpen ? { year: oldestOpen.year, month: oldestOpen.month, roNumber: oldestOpen.roNumber, lastName: oldestOpen.lastName, amount: num(oldestOpen.amount) } : null,
      months,
      numbers: {
        lastIssued: seq ? `${seq.prefix}${seq.padLength > 0 ? String(seq.current).padStart(seq.padLength, '0') : seq.current}` : null,
        assigned: assignedCount,
        latest: lastAssigned ? { number: lastAssigned.number, towneRo: lastAssigned.towneRoNumber, vehicle: [lastAssigned.vehicleYear, lastAssigned.vehicleMake, lastAssigned.vehicleModel].filter(Boolean).join(' '), customer: lastAssigned.customerName, at: lastAssigned.createdAt } : null,
      },
      activeRos,
    } })
  } catch (err) {
    console.error('Admin hub BMW error:', err)
    res.status(500).json({ success: false, error: 'Internal server error.' })
  }
})

module.exports = router
