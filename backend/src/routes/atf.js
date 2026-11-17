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
const { crewPhotos, photoFor } = require('../lib/crew')

router.get('/display', async (req, res) => {
  const key = process.env.ATF_DISPLAY_KEY
  if (!key) return res.status(404).json({ success: false, error: 'Display not set up' })
  if (!crypto.timingSafeEqual(sha(req.query.key || ''), sha(key))) return res.status(401).json({ success: false, error: 'Wrong display key' })
  try {
    const [list, photos, techs] = await Promise.all([listAtf(), crewPhotos(), prisma.technician.findMany({ select: { name: true, profile: true } })])
    const profiles = Object.fromEntries(techs.map((t) => [t.name.trim().toLowerCase(), t.profile]))
    const items = list.map((a) => ({
      id: a.id, roNumber: a.roNumber, vehicle: a.vehicle, part: a.part, qty: a.qty, qtyReceived: a.qtyReceived,
      tech: a.tech, techPhoto: photoFor(photos, a.tech), techPhotoLarge: photoFor(photos, a.tech, 480),
      techProfile: profiles[String(a.tech || '').trim().toLowerCase()] || null, partNumber: a.partNumber, status: a.status, backordered: a.chaseStatus === 'BACKORDERED',
      requestedAt: a.requestedAt, orderedAt: a.orderedAt, etaDate: a.etaDate, receivedAt: a.receivedAt,
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

// PUT /api/atf/:id — fix a request entered wrong: { roNumber?, description?, partNumber?, qty?, tech? }.
// A new RO number moves the part to that RO. Status changes go through PUT /api/parts/:id as before.
router.put('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)
  const b = req.body || {}
  const username = req.user?.username || null
  try {
    const part = await prisma.part.findUnique({ where: { id }, include: { ro: { select: { id: true, roNumber: true } } } })
    if (!part || !part.isAtf) return res.status(404).json({ success: false, error: 'After-the-fact request not found.' })
    const data = {}
    const changes = []
    if (b.description !== undefined) {
      const v = String(b.description).trim()
      if (!v) return res.status(400).json({ success: false, error: 'Enter the part.' })
      if (v !== part.description) { data.description = v; changes.push(`part "${part.description || ''}" → "${v}"`) }
    }
    if (b.partNumber !== undefined) {
      const v = String(b.partNumber).trim() || null
      if (v !== part.partNumber) { data.partNumber = v; changes.push(`part # ${part.partNumber || '—'} → ${v || '—'}`) }
    }
    if (b.qty !== undefined) {
      const v = Math.max(1, parseInt(b.qty) || 1)
      if (v !== part.qty) { data.qty = v; changes.push(`qty ${part.qty} → ${v}`) }
    }
    if (b.tech !== undefined) {
      const v = String(b.tech).trim().slice(0, 80)
      if (!v) return res.status(400).json({ success: false, error: 'Pick the tech who asked for it.' })
      if (v !== part.requestedBy) { data.requestedBy = v; changes.push(`asked by ${part.requestedBy || '—'} → ${v}`) }
    }
    let newRo = null
    if (b.roNumber !== undefined) {
      const v = String(b.roNumber).trim()
      if (v && v !== part.ro.roNumber) {
        newRo = await prisma.rO.findUnique({ where: { roNumber: v } })
        if (!newRo) return res.status(404).json({ success: false, error: `RO ${v} isn't in Towne Parts. Check the number, or add the RO first.` })
        data.roId = newRo.id
        changes.push(`moved from RO ${part.ro.roNumber} to RO ${v}`)
      }
    }
    if (!changes.length) return res.json({ success: true, data: { id } })
    await prisma.part.update({ where: { id }, data })
    await prisma.partEvent.create({ data: { partId: id, type: 'NOTE', message: `Edited: ${changes.join('; ')}`, username } })
    const label = data.description || part.description || part.partNumber || 'part'
    await prisma.activityLog.create({ data: { roId: part.ro.id, eventType: 'PART_UPDATED', message: `After-the-fact request edited (${label}): ${changes.join('; ')}${username ? ` by ${username}` : ''}` } })
    if (newRo) {
      await prisma.activityLog.create({ data: { roId: newRo.id, eventType: 'PART_ADDED', message: `After-the-fact part moved here from RO ${part.ro.roNumber}: ${label}` } })
      if (!part.isReceived) await prisma.rO.update({ where: { id: newRo.id }, data: { partsStatus: 'MISSING' } })
    }
    res.json({ success: true, data: { id } })
  } catch (err) {
    console.error('ATF edit error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/atf/:id — remove a request that was entered by mistake (it never existed).
// For a part that just isn't needed any more, use "Not needed" instead so the history stays.
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const part = await prisma.part.findUnique({ where: { id } })
    if (!part || !part.isAtf) return res.status(404).json({ success: false, error: 'After-the-fact request not found.' })
    await prisma.part.delete({ where: { id } })
    await prisma.activityLog.create({ data: { roId: part.roId, eventType: 'PART_DELETED', message: `After-the-fact request deleted: ${part.description || part.partNumber || 'part'} (asked by ${part.requestedBy || '—'})${req.user?.username ? ` by ${req.user.username}` : ''}` } })
    res.json({ success: true })
  } catch (err) {
    console.error('ATF delete error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
module.exports.listAtf = listAtf
