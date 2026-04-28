const express = require('express')
const https   = require('https')
const router  = express.Router()
const prisma  = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

// ── Telegram helper ───────────────────────────────────────────────────────────
function sendTelegramMessage(text) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_SUPP_CHAT_ID, TELEGRAM_CHAT_ID } = process.env
  const chatId = TELEGRAM_SUPP_CHAT_ID || TELEGRAM_CHAT_ID
  if (!TELEGRAM_BOT_TOKEN || !chatId) return Promise.resolve()

  const body = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  })

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => resolve(data))
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

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
    const id = parseInt(req.params.id)
    const { status, insuranceCompany, notes } = req.body
    const data = {}
    if (status           !== undefined) data.status           = status
    if (insuranceCompany !== undefined) data.insuranceCompany = insuranceCompany
    if (notes            !== undefined) data.notes            = notes

    // Fetch existing record so we know the previous status
    const before = await prisma.supplement.findUnique({
      where: { id },
      include: {
        ro: {
          select: {
            id: true, roNumber: true,
            vehicleYear: true, vehicleMake: true, vehicleModel: true,
            ownerName: true, insuranceCompany: true,
          },
        },
      },
    })

    const supplement = await prisma.supplement.update({ where: { id }, data })

    // Fire Telegram when status transitions to FILED
    if (status === 'FILED' && before?.status !== 'FILED' && before?.ro) {
      const ro   = before.ro
      const year = ro.vehicleYear || ''
      const make = ro.vehicleMake || ''
      const model = ro.vehicleModel || ''
      const vehicle = [year, make, model].filter(Boolean).join(' ')
      const customer = ro.ownerName || 'Customer'
      const insurance = (data.insuranceCompany ?? before.insuranceCompany) || ro.insuranceCompany || 'Insurance'
      const suppLabel = `Supplement ${before.number}`

      const text = `RO ${ro.roNumber} | ${vehicle} | ${customer} : ${suppLabel} has been filed with ${insurance} 📋`

      sendTelegramMessage(text).catch((err) =>
        console.error('Telegram supplement-filed error:', err.message)
      )
    }

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
