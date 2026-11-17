// After-the-fact (ATF) part orders: parts a tech asks for once a job is underway. Techs bring
// the request to Gene; he enters it here (RO, part, who asked), orders it, and checks it in.
// The same list feeds the shop TV screen (/atf-display) through GET /api/atf/display.
//
// An ATF order is an ordinary Part on the RO with isAtf = true, so everything else (RO page,
// Still Out, check-in, photos, the part's timeline) works on it unchanged. Status comes from
// the part's own fields:
//   not ordered → chaseStatus NEED_TO_ORDER    ordered → any other open status    here → isReceived
// "Not needed" parts drop off the list.
const express = require('express')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// Start of today in shop time (Eastern), as a real Date
function startOfShopDay() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const offset = Date.now() - nowET.getTime()
  return new Date(new Date(nowET).setHours(0, 0, 0, 0) + offset)
}

const atfStatus = (p) => (p.isReceived ? 'HERE' : p.chaseStatus === 'NEED_TO_ORDER' ? 'NOT_ORDERED' : 'ORDERED')

// Open ATF orders + the ones that arrived today (so the crew sees they came in), most urgent first
async function listAtf() {
  const parts = await prisma.part.findMany({
    where: {
      isAtf: true,
      chaseStatus: { not: 'NOT_NEEDED' },
      OR: [{ isReceived: false }, { receivedAt: { gte: startOfShopDay() } }],
    },
    include: { ro: { select: { id: true, roNumber: true, vehicleYear: true, vehicleMake: true, vehicleModel: true } } },
  })
  const rank = { NOT_ORDERED: 0, ORDERED: 1, HERE: 2 }
  return parts
    .map((p) => ({
      id: p.id,
      roId: p.ro.id,
      roNumber: p.ro.roNumber,
      vehicle: [p.ro.vehicleYear, p.ro.vehicleMake, p.ro.vehicleModel].filter(Boolean).join(' '),
      part: p.description || p.partNumber || 'Part',
      partNumber: p.partNumber,
      qty: p.qty,
      qtyReceived: p.qtyReceived,
      tech: p.requestedBy,
      status: atfStatus(p),
      chaseStatus: p.chaseStatus,
      requestedAt: p.requestedAt || p.createdAt,
      orderedAt: p.dateOrdered,
      etaDate: p.etaDate,
      receivedAt: p.receivedAt,
    }))
    .sort((a, b) => rank[a.status] - rank[b.status] ||
      (a.status === 'HERE' ? new Date(b.receivedAt) - new Date(a.receivedAt) : new Date(a.requestedAt) - new Date(b.requestedAt)))
}

router.get('/', requireAuth, async (req, res) => {
  try {
    res.json({ success: true, data: await listAtf() })
  } catch (err) {
    console.error('ATF list error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/atf/display?key=… — read-only list for the shop TV screen (/atf-display). The TVs
// don't sign in (a login would expire); they use ATF_DISPLAY_KEY instead, which only opens this
// list. Off (404) until the key is set. Rotate it by changing the Railway variable.
const crypto = require('crypto')
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest()
router.get('/display', async (req, res) => {
  const key = process.env.ATF_DISPLAY_KEY
  if (!key) return res.status(404).json({ success: false, error: 'Display not set up' })
  if (!crypto.timingSafeEqual(sha(req.query.key || ''), sha(key))) return res.status(401).json({ success: false, error: 'Wrong display key' })
  try {
    const items = (await listAtf()).map((a) => ({
      id: a.id, roNumber: a.roNumber, vehicle: a.vehicle, part: a.part, qty: a.qty, qtyReceived: a.qtyReceived,
      tech: a.tech, status: a.status, backordered: a.chaseStatus === 'BACKORDERED',
      requestedAt: a.requestedAt, etaDate: a.etaDate, receivedAt: a.receivedAt,
    }))
    res.json({ success: true, data: items })
  } catch (err) {
    console.error('ATF display error:', err)
    res.status(500).json({ success: false, error: 'Could not load the list' })
  }
})

// POST /api/atf — { roNumber, description, partNumber?, qty?, tech, ordered? }
router.post('/', requireAuth, async (req, res) => {
  const b = req.body || {}
  const roNumber = String(b.roNumber || '').trim()
  const description = String(b.description || '').trim()
  const tech = String(b.tech || '').trim()
  if (!roNumber) return res.status(400).json({ success: false, error: 'Enter the RO number.' })
  if (!description) return res.status(400).json({ success: false, error: 'Enter the part.' })
  if (!tech) return res.status(400).json({ success: false, error: 'Pick the tech who asked for it.' })
  try {
    const ro = await prisma.rO.findUnique({ where: { roNumber } })
    if (!ro) return res.status(404).json({ success: false, error: `RO ${roNumber} isn't in Towne Parts. Check the number, or add the RO first.` })
    const ordered = b.ordered === true
    const now = new Date()
    const username = req.user?.username || null
    const part = await prisma.part.create({
      data: {
        roId: ro.id,
        description,
        partNumber: String(b.partNumber || '').trim() || null,
        qty: Math.max(1, parseInt(b.qty) || 1),
        isAtf: true,
        requestedBy: tech.slice(0, 80),
        requestedAt: now,
        chaseStatus: ordered ? 'ORDERED' : 'NEED_TO_ORDER',
        dateOrdered: ordered ? new Date(now.toISOString().slice(0, 10)) : null,
      },
    })
    await prisma.partEvent.create({
      data: { partId: part.id, type: 'ADDED', message: `After-the-fact request from ${part.requestedBy}${ordered ? ' — ordered' : ' — needs ordering'}`, username },
    })
    await prisma.rO.update({ where: { id: ro.id }, data: { partsStatus: 'MISSING' } })
    await prisma.activityLog.create({
      data: { roId: ro.id, eventType: 'PART_ADDED', message: `After-the-fact part requested by ${part.requestedBy}: ${description}${username ? ` (entered by ${username})` : ''}` },
    })
    res.json({ success: true, data: { id: part.id, roId: ro.id } })
  } catch (err) {
    console.error('ATF create error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
module.exports.listAtf = listAtf
