const express = require('express')
const axios = require('axios')
const router = express.Router()
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)

const STEALTH_CATALOG_URL = 'https://stealthhitches.com/collections/hitches/products.json?limit=250'
const STEALTH_PRODUCT_BASE_URL = 'https://stealthhitches.com/products/'

const TIERS = {
  RACK_ONLY:        { label: 'Rack Only',                        fee: 800 },
  RACK_AND_TOW:      { label: 'Rack and Tow',                     fee: 1000 },
  RACK_TOW_WIRING:   { label: 'Rack and Tow w/ Active Wiring',    fee: 1200 },
}
const SHIPPING = 40
const TAX_RATE = 0.0635

// ── GET /api/hitches/tiers  — fee tier config for the frontend ───────────────
router.get('/tiers', (req, res) => {
  res.json({ success: true, data: { tiers: TIERS, shipping: SHIPPING, taxRate: TAX_RATE, stealthBaseUrl: STEALTH_PRODUCT_BASE_URL } })
})

// Titles are fitment strings like "2011-2018 Volvo V60" or "2020 Audi Q5 Plug-in
// Hybrid" — a plain substring search misses "2012" against a "2011-2018" range.
// Pull every 4-digit year (and year range) out of the title so a typed year can
// be checked against the range instead of requiring an exact literal match.
function extractYearRanges(title) {
  const ranges = []
  const re = /\b(\d{4})(?:-(\d{4}))?\b/g
  let m
  while ((m = re.exec(title))) {
    const start = parseInt(m[1], 10)
    const end = m[2] ? parseInt(m[2], 10) : start
    ranges.push([start, end])
  }
  return ranges
}

function kitMatchesQuery(kit, query) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const titleLower = kit.title.toLowerCase()
  const ranges = extractYearRanges(kit.title)
  return tokens.every((tok) => {
    if (/^\d{4}$/.test(tok)) {
      const year = parseInt(tok, 10)
      return ranges.some(([start, end]) => year >= start && year <= end)
    }
    return titleLower.includes(tok)
  })
}

// ── GET /api/hitches/kits?q=x5  — search the cached catalog ──────────────────
router.get('/kits', async (req, res) => {
  try {
    const { q } = req.query
    const allKits = await prisma.hitchKit.findMany({ orderBy: { title: 'asc' } })
    const kits = q ? allKits.filter((k) => kitMatchesQuery(k, q)) : allKits
    res.json({ success: true, data: kits.slice(0, 30) })
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
    const { hitchKitId, tier, customerName, customerPhone, customerEmail, notes, kitPriceOverride } = req.body

    if (!hitchKitId) return res.status(400).json({ success: false, error: 'hitchKitId is required' })
    if (!TIERS[tier]) return res.status(400).json({ success: false, error: 'Invalid tier' })

    const kit = await prisma.hitchKit.findUnique({ where: { id: parseInt(hitchKitId) } })
    if (!kit) return res.status(404).json({ success: false, error: 'Hitch kit not found' })
    if (kit.rackOnly && tier !== 'RACK_ONLY') {
      return res.status(400).json({ success: false, error: 'This kit is Rack Only — only that tier is available' })
    }

    // Stealth's cached price is the "Rack Only" base — their site adds a separate
    // conversion-kit surcharge for tow packages via client-side JS that isn't in
    // the public product feed, so it can't be trusted for tow tiers. Staff verify
    // via the "View on Stealth" link and can override the price at quote time.
    const kitPrice = kitPriceOverride != null && kitPriceOverride !== ''
      ? parseFloat(kitPriceOverride)
      : parseFloat(kit.price)
    if (isNaN(kitPrice)) return res.status(400).json({ success: false, error: 'Invalid kit price' })
    const tierFee = TIERS[tier].fee
    const subtotal = kitPrice + tierFee + SHIPPING
    const tax = Math.round(subtotal * TAX_RATE * 100) / 100
    const total = Math.round((subtotal + tax) * 100) / 100

    const quote = await prisma.hitchQuote.create({
      data: {
        hitchKitId: kit.id,
        vehicleTitle: kit.title,
        kitHandle: kit.handle,
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
