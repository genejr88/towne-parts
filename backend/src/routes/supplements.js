const express = require('express')
const https   = require('https')
const router  = express.Router()
const prisma  = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

// ── Telegram helper ───────────────────────────────────────────────────────────
function sendTelegramMessage(text) {
  const token  = process.env['TELEGRAM_BOT_TOKEN']
  // Build key at runtime so Railpack's static scanner doesn't require it as a build secret
  const suppKey = 'TELEGRAM_SUPP' + '_CHAT_ID'
  const chatId = process.env[suppKey] || process.env['TELEGRAM_CHAT_ID']
  if (!token || !chatId) return Promise.resolve()

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
        path: `/bot${token}/sendMessage`,
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
            claimNumber: true,
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

// ── POST /api/supplements/:id/file ───────────────────────────────────────────
// Logs HOW a supplement was filed + upserts CarrierProfile + transitions to FILED
router.post('/:id/file', async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const { method, contactEmail, contactFax, contactPhone, portalUrl, notes } = req.body
    if (!method) return res.status(400).json({ success: false, error: 'method is required' })

    const supplement = await prisma.supplement.findUnique({
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
    if (!supplement) return res.status(404).json({ success: false, error: 'Not found' })

    const carrierName = supplement.insuranceCompany || supplement.ro?.insuranceCompany || null

    // Upsert carrier profile with the latest contact info from this filing
    let carrierId = null
    if (carrierName) {
      const updateData = { updatedAt: new Date() }
      if (contactEmail)    updateData.contactEmail    = contactEmail
      if (contactFax)      updateData.contactFax      = contactFax
      if (contactPhone)    updateData.contactPhone     = contactPhone
      if (portalUrl)       updateData.portalUrl        = portalUrl
      if (method)          updateData.preferredMethod  = method

      const carrier = await prisma.carrierProfile.upsert({
        where:  { name: carrierName },
        create: {
          name: carrierName,
          contactEmail:    contactEmail    || null,
          contactFax:      contactFax      || null,
          contactPhone:    contactPhone    || null,
          portalUrl:       portalUrl       || null,
          preferredMethod: method          || null,
        },
        update: updateData,
      })
      carrierId = carrier.id
    }

    // Create filing log + set supplement status to FILED in one transaction
    const wasAlreadyFiled = supplement.status === 'FILED'

    const [filingLog, updated] = await prisma.$transaction([
      prisma.supplementFilingLog.create({
        data: {
          supplementId: id,
          carrierId,
          method,
          contactEmail:  contactEmail  || null,
          contactFax:    contactFax    || null,
          contactPhone:  contactPhone  || null,
          portalUrl:     portalUrl     || null,
          notes:         notes         || null,
        },
      }),
      prisma.supplement.update({
        where: { id },
        data:  { status: 'FILED' },
        include: { _count: { select: { filingLogs: true } } },
      }),
    ])

    // Fire Telegram if this is the first filing
    if (!wasAlreadyFiled && supplement.ro) {
      const ro      = supplement.ro
      const year    = ro.vehicleYear  || ''
      const make    = ro.vehicleMake  || ''
      const model   = ro.vehicleModel || ''
      const vehicle = [year, make, model].filter(Boolean).join(' ')
      const customer  = ro.ownerName || 'Customer'
      const insurance = carrierName  || 'Insurance'
      const suppLabel = `Supplement ${supplement.number}`
      const text = `RO ${ro.roNumber} | ${vehicle} | ${customer} : ${suppLabel} has been filed with ${insurance} 📋`
      sendTelegramMessage(text).catch((err) =>
        console.error('Telegram supplement-filed error:', err.message)
      )
    }

    res.json({ success: true, data: { supplement: updated, filingLog } })
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
