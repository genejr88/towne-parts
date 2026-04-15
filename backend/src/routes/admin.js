/**
 * admin.js — Temporary migration endpoints
 * GET  /api/admin/export  — dumps all DB rows + file contents (base64) as JSON
 * POST /api/admin/import  — restores a previously exported JSON to this server
 *
 * Protected by ADMIN_EXPORT_KEY env var (set the same value on both servers).
 * Remove this file once migration is done.
 */

const express = require('express')
const fs      = require('fs')
const path    = require('path')
const prisma  = require('../lib/prisma')

const router = express.Router()
const UPLOADS_BASE = path.join(__dirname, '../../uploads')

// Simple key auth — set ADMIN_EXPORT_KEY in Railway env vars on both projects
function checkKey(req, res) {
  const key = process.env.ADMIN_EXPORT_KEY
  if (!key) { res.status(500).json({ error: 'ADMIN_EXPORT_KEY not configured on server' }); return false }
  if (req.headers['x-admin-key'] !== key) { res.status(401).json({ error: 'Unauthorized' }); return false }
  return true
}

// ── GET /api/admin/export ────────────────────────────────────────────────────
router.get('/export', async (req, res) => {
  if (!checkKey(req, res)) return
  try {
    console.log('[EXPORT] Starting full export…')

    const [vendors, ros, parts, partPhotos, roInvoices, srcEntries, activityLog] =
      await Promise.all([
        prisma.vendor.findMany({ orderBy: { id: 'asc' } }),
        prisma.rO.findMany({ orderBy: { id: 'asc' } }),
        prisma.part.findMany({ orderBy: { id: 'asc' } }),
        prisma.partPhoto.findMany({ orderBy: { id: 'asc' } }),
        prisma.rOInvoice.findMany({ orderBy: { id: 'asc' } }),
        prisma.sRCEntry.findMany({ orderBy: { id: 'asc' } }),
        prisma.activityLog.findMany({ orderBy: { id: 'asc' } }),
      ])

    console.log(`[EXPORT] vendors=${vendors.length} ros=${ros.length} parts=${parts.length} photos=${partPhotos.length} invoices=${roInvoices.length}`)

    // Read every file in uploads/ and base64-encode it
    const files = []
    function walkDir(dir, base) {
      if (!fs.existsSync(dir)) return
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry)
        const rel  = path.join(base, entry)
        if (fs.statSync(full).isDirectory()) {
          walkDir(full, rel)
        } else {
          try {
            const data = fs.readFileSync(full).toString('base64')
            files.push({ rel: rel.replace(/\\/g, '/'), data })
          } catch (e) {
            console.warn(`[EXPORT] Could not read ${full}: ${e.message}`)
          }
        }
      }
    }
    walkDir(UPLOADS_BASE, '')
    console.log(`[EXPORT] ${files.length} files encoded`)

    res.json({
      exportedAt: new Date().toISOString(),
      db: { vendors, ros, parts, partPhotos, roInvoices, srcEntries, activityLog },
      files,
    })
    console.log('[EXPORT] Done.')
  } catch (err) {
    console.error('[EXPORT] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/admin/import ───────────────────────────────────────────────────
router.post('/import', express.json({ limit: '500mb' }), async (req, res) => {
  if (!checkKey(req, res)) return
  try {
    const { db, files } = req.body
    if (!db) return res.status(400).json({ error: 'Missing db payload' })

    console.log('[IMPORT] Starting import…')
    const stats = { vendors: 0, ros: 0, parts: 0, photos: 0, invoices: 0, src: 0, activity: 0, files: 0 }

    // Restore files
    if (Array.isArray(files)) {
      for (const { rel, data } of files) {
        const dest = path.join(UPLOADS_BASE, rel)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, Buffer.from(data, 'base64'))
        stats.files++
      }
      console.log(`[IMPORT] ${stats.files} files restored`)
    }

    // ID maps: old id → new id
    const vendorMap = {}, roMap = {}, partMap = {}

    // Vendors
    for (const v of (db.vendors || [])) {
      const ex = await prisma.vendor.findUnique({ where: { name: v.name } })
      if (ex) { vendorMap[v.id] = ex.id; continue }
      const n = await prisma.vendor.create({ data: { name: v.name, isActive: v.isActive, createdAt: new Date(v.createdAt) } })
      vendorMap[v.id] = n.id; stats.vendors++
    }

    // ROs
    for (const ro of (db.ros || [])) {
      const ex = await prisma.rO.findUnique({ where: { roNumber: ro.roNumber } })
      if (ex) { roMap[ro.id] = ex.id; continue }
      const n = await prisma.rO.create({
        data: {
          roNumber: ro.roNumber, vehicleYear: ro.vehicleYear, vehicleMake: ro.vehicleMake,
          vehicleModel: ro.vehicleModel, vehicleColor: ro.vehicleColor, vin: ro.vin,
          vendorId: ro.vendorId ? (vendorMap[ro.vendorId] ?? null) : null,
          partsStatus: ro.partsStatus, productionStage: ro.productionStage,
          productionStatusNote: ro.productionStatusNote, productionWaitingParts: ro.productionWaitingParts,
          productionNextStep: ro.productionNextStep, productionFinalSupplement: ro.productionFinalSupplement,
          productionSupplementNote: ro.productionSupplementNote,
          productionUpdatedAt: ro.productionUpdatedAt ? new Date(ro.productionUpdatedAt) : null,
          isArchived: ro.isArchived, archivedAt: ro.archivedAt ? new Date(ro.archivedAt) : null,
          createdAt: new Date(ro.createdAt),
        },
      })
      roMap[ro.id] = n.id; stats.ros++
    }

    // Parts
    for (const p of (db.parts || [])) {
      const destROId = roMap[p.roId]
      if (!destROId) continue
      const ex = await prisma.part.findFirst({ where: { roId: destROId, partNumber: p.partNumber, description: p.description } })
      if (ex) { partMap[p.id] = ex.id; continue }
      const n = await prisma.part.create({
        data: {
          roId: destROId, qty: p.qty, partNumber: p.partNumber, description: p.description,
          dateOrdered: p.dateOrdered ? new Date(p.dateOrdered) : null,
          etaDate: p.etaDate ? new Date(p.etaDate) : null,
          finishStatus: p.finishStatus, isReceived: p.isReceived, hasCore: p.hasCore,
          receivedAt: p.receivedAt ? new Date(p.receivedAt) : null,
          price: p.price ?? null, createdAt: new Date(p.createdAt),
        },
      })
      partMap[p.id] = n.id; stats.parts++
    }

    // Part photos (DB records — files already restored above)
    for (const ph of (db.partPhotos || [])) {
      const destPartId = partMap[ph.partId]
      if (!destPartId) continue
      const ex = await prisma.partPhoto.findFirst({ where: { partId: destPartId, storedPath: ph.storedPath } })
      if (ex) continue
      await prisma.partPhoto.create({
        data: { partId: destPartId, originalFilename: ph.originalFilename, storedPath: ph.storedPath, createdAt: new Date(ph.createdAt) },
      })
      stats.photos++
    }

    // RO Invoices
    for (const inv of (db.roInvoices || [])) {
      const destROId = roMap[inv.roId]
      if (!destROId) continue
      const ex = await prisma.rOInvoice.findFirst({ where: { roId: destROId, originalFilename: inv.originalFilename } })
      if (ex) continue
      await prisma.rOInvoice.create({
        data: { roId: destROId, originalFilename: inv.originalFilename, storedPath: inv.storedPath, uploadedBy: inv.uploadedBy, createdAt: new Date(inv.createdAt) },
      })
      stats.invoices++
    }

    // SRC
    for (const e of (db.srcEntries || [])) {
      const destROId = roMap[e.roId]
      if (!destROId) continue
      await prisma.sRCEntry.create({
        data: { roId: destROId, entryType: e.entryType, status: e.status, note: e.note, createdBy: e.createdBy, completedAt: e.completedAt ? new Date(e.completedAt) : null, createdAt: new Date(e.createdAt) },
      })
      stats.src++
    }

    // Activity
    for (const a of (db.activityLog || [])) {
      const destROId = roMap[a.roId]
      if (!destROId) continue
      await prisma.activityLog.create({
        data: { roId: destROId, eventType: a.eventType, message: a.message, createdAt: new Date(a.createdAt) },
      })
      stats.activity++
    }

    // Reset sequences
    const seqNames = ['users_id_seq','vendors_id_seq','ros_id_seq','parts_id_seq',
                      'part_photos_id_seq','ro_invoices_id_seq','src_entries_id_seq','activity_log_id_seq']
    for (const seq of seqNames) {
      try { await prisma.$executeRawUnsafe(`ALTER SEQUENCE "${seq}" RESTART WITH 10000`) } catch (_) {}
    }

    console.log('[IMPORT] Done.', stats)
    res.json({ success: true, stats })
  } catch (err) {
    console.error('[IMPORT] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
