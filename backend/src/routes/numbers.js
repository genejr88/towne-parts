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

// All assigned-number routes require PIN auth (same gate as the vault)
router.use(requirePin)

function formatNumber(seq) {
  const numStr = seq.padLength > 0 ? String(seq.current).padStart(seq.padLength, '0') : String(seq.current)
  return `${seq.prefix}${numStr}`
}

// ── GET /api/numbers?program=BMW  ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { program } = req.query
    if (!program) return res.status(400).json({ success: false, error: 'program is required' })

    const records = await prisma.assignedNumber.findMany({
      where: { program },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: records })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── GET /api/numbers/next-preview?program=BMW  — shows what "Generate" will produce, without consuming it ──
router.get('/next-preview', async (req, res) => {
  try {
    const { program } = req.query
    if (!program) return res.status(400).json({ success: false, error: 'program is required' })

    const seq = await prisma.numberSequence.findUnique({ where: { program } })
    if (!seq) return res.status(404).json({ success: false, error: `No sequence configured for program "${program}"` })

    const preview = formatNumber({ ...seq, current: seq.current + 1 })
    res.json({ success: true, data: { preview } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── POST /api/numbers/:program/next  — atomically issues the next number ─────
router.post('/:program/next', async (req, res) => {
  try {
    const { program } = req.params

    const record = await prisma.$transaction(async (tx) => {
      const seq = await tx.numberSequence.findUnique({ where: { program } })
      if (!seq) throw new Error(`No sequence configured for program "${program}"`)

      const updated = await tx.numberSequence.update({
        where: { program },
        data: { current: { increment: 1 } },
      })

      return tx.assignedNumber.create({
        data: { program, number: formatNumber(updated) },
      })
    })

    res.json({ success: true, data: record })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── PUT /api/numbers/:id  ─────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { number, programRoNumber, towneRoNumber, vehicleYear, vehicleMake, vehicleModel, customerName } = req.body
    const data = {}
    if (number          !== undefined) data.number          = number
    if (programRoNumber !== undefined) data.programRoNumber = programRoNumber
    if (towneRoNumber   !== undefined) data.towneRoNumber   = towneRoNumber
    if (vehicleYear     !== undefined) data.vehicleYear     = vehicleYear
    if (vehicleMake     !== undefined) data.vehicleMake     = vehicleMake
    if (vehicleModel    !== undefined) data.vehicleModel    = vehicleModel
    if (customerName    !== undefined) data.customerName    = customerName

    const record = await prisma.assignedNumber.update({
      where: { id: parseInt(req.params.id) },
      data,
    })
    res.json({ success: true, data: record })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── DELETE /api/numbers/:id  ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await prisma.assignedNumber.delete({ where: { id: parseInt(req.params.id) } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
