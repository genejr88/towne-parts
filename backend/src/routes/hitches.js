const express = require('express')
const axios = require('axios')
const router = express.Router()
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)

const STEALTH_CATALOG_URL = 'https://stealthhitches.com/collections/hitches/products.json?limit=250'

const TIERS = {
  RACK_ONLY:        { label: 'Rack Only',                        fee: 800 },
  RACK_AND_TOW:      { label: 'Rack and Tow',                     fee: 1000 },
  RACK_TOW_WIRING:   { label: 'Rack and Tow w/ Active Wiring',    fee: 1200 },
}
const SHIPPING = 40
const TAX_RATE = 0.0635

// ── GET /api/hitches/tiers  — fee tier config for the frontend ───────────────
router.get('/tiers', (req, res) => {
  res.json({ success: true, data: { tiers: TIERS, shipping: SHIPPING, taxRate: TAX_RATE } })
})

// ── GET /api/hitches/kits?q=x5  — search the cached catalog ──────────────────
router.get('/kits', async (req, res) => {
  try {
    const { q } = req.query
    const where = q ? { title: { contains: q, mode: 'insensitive' } } : {}
    const kits = await prisma.hitchKit.findMany({
      where,
      orderBy: { title: 'asc' },
      take: 30,
    })
    res.json({ success: true, data: kits })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── GET /api/hitches/kits/status  — last sync time + count ───────────────────
router.get('/kits/status', async (req, res) => {
  try {
    const count = await prisma.hitchKit.count()
    const latest = await prisma.hitchKit.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } })
    res.json({ success: true, data: { count, lastSyncedAt: latest?.syncedAt || null } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── POST /api/hitches/kits/refresh  — pull the latest catalog from Stealth ───
router.post('/kits/refresh', async (req, res) => {
  try {
    const { data } = await axios.get(STEALTH_CATALOG_URL, { timeout: 15000 })
    const products = data.products || []

    let upserted = 0
    for (const p of products) {
      const variant = p.variants?.[0]
      if (!variant) continue

      await prisma.hitchKit.upsert({
        where: { shopifyId: String(p.id) },
        update: {
          handle: p.handle,
          title: p.title,
          sku: variant.sku || null,
          price: parseFloat(variant.price),
          available: !!variant.available,
          rackOnly: /rack only/i.test(p.title),
          syncedAt: new Date(),
        },
        create: {
          shopifyId: String(p.id),
          handle: p.handle,
          title: p.title,
          sku: variant.sku || null,
          price: parseFloat(variant.price),
          available: !!variant.available,
          rackOnly: /rack only/i.test(p.title),
        },
      })
      upserted++
    }

    res.json({ success: true, data: { upserted, total: products.length } })
  } catch (err) {
    console.error('Hitch catalog refresh error:', err)
    res.status(502).json({ success: false, error: 'Failed to fetch catalog from Stealth Hitches. ' + err.message })
  }
})

// ── PUT /api/hitches/kits/:id  — manual override (e.g. fix rackOnly flag) ────
router.put('/kits/:id', async (req, res) => {
  try {
    const { rackOnly } = req.body
    const data = {}
    if (rackOnly !== undefined) data.rackOnly = !!rackOnly

    const kit = await prisma.hitchKit.update({ where: { id: parseInt(req.params.id) }, data })
    res.json({ success: true, data: kit })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── GET /api/hitches/quotes?search=x  — quote history ─────────────────────────
router.get('/quotes', async (req, res) => {
  try {
    const { search } = req.query
    const where = search
      ? {
          OR: [
            { vehicleTitle: { contains: search, mode: 'insensitive' } },
            { customerName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}
    const quotes = await prisma.hitchQuote.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
    res.json({ success: true, data: quotes })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── GET /api/hitches/quotes/:id  ──────────────────────────────────────────────
router.get('/quotes/:id', async (req, res) => {
  try {
    const quote = await prisma.hitchQuote.findUnique({ where: { id: parseInt(req.params.id) } })
    if (!quote) return res.status(404).json({ success: false, error: 'Quote not found' })
    res.json({ success: true, data: quote })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── POST /api/hitches/quotes  — build + save a quote ─────────────────────────
router.post('/quotes', async (req, res) => {
  try {
    const { hitchKitId, tier, customerName, customerPhone, customerEmail, notes } = req.body

    if (!hitchKitId) return res.status(400).json({ success: false, error: 'hitchKitId is required' })
    if (!TIERS[tier]) return res.status(400).json({ success: false, error: 'Invalid tier' })

    const kit = await prisma.hitchKit.findUnique({ where: { id: parseInt(hitchKitId) } })
    if (!kit) return res.status(404).json({ success: false, error: 'Hitch kit not found' })
    if (kit.rackOnly && tier !== 'RACK_ONLY') {
      return res.status(400).json({ success: false, error: 'This kit is Rack Only — only that tier is available' })
    }

    const kitPrice = parseFloat(kit.price)
    const tierFee = TIERS[tier].fee
    const subtotal = kitPrice + tierFee + SHIPPING
    const tax = Math.round(subtotal * TAX_RATE * 100) / 100
    const total = Math.round((subtotal + tax) * 100) / 100

    const quote = await prisma.hitchQuote.create({
      data: {
        hitchKitId: kit.id,
        vehicleTitle: kit.title,
        kitPrice,
        tier,
        tierFee,
        shipping: SHIPPING,
        taxRate: TAX_RATE,
        subtotal,
        tax,
        total,
        customerName: customerName?.trim() || null,
        customerPhone: customerPhone?.trim() || null,
        customerEmail: customerEmail?.trim() || null,
        notes: notes?.trim() || null,
        createdBy: req.user?.username || null,
      },
    })

    res.json({ success: true, data: quote })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── DELETE /api/hitches/quotes/:id  ───────────────────────────────────────────
router.delete('/quotes/:id', async (req, res) => {
  try {
    await prisma.hitchQuote.delete({ where: { id: parseInt(req.params.id) } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
