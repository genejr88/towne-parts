const express = require('express')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')
const fileStore = require('../lib/storage')

const router = express.Router()

// ── Photo upload setup ────────────────────────────────────────────────────────
const partsPhotosDir = path.join(__dirname, '../../uploads/parts')
if (!fs.existsSync(partsPhotosDir)) {
  fs.mkdirSync(partsPhotosDir, { recursive: true })
}

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, partsPhotosDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
    const ext = path.extname(file.originalname)
    cb(null, `part-${unique}${ext}`)
  },
})

const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.bmp', '.heic', '.heif']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowed.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error(`File type not allowed: ${ext}`))
    }
  },
})

/**
 * Recompute partsStatus for an RO based on all its parts.
 * - No parts or any non-received → MISSING
 * - All received → ALL_HERE
 * Called after any part received status change.
 */
async function syncROPartsStatus(roId) {
  const parts = await prisma.part.findMany({
    where: { roId },
    select: { isReceived: true, chaseStatus: true },
  })

  if (parts.length === 0) return

  // "Not needed" parts count as done without being received
  const allReceived = parts.every((p) => p.isReceived || p.chaseStatus === 'NOT_NEEDED')

  const newStatus = allReceived ? 'ALL_HERE' : 'MISSING'

  await prisma.rO.update({
    where: { id: roId },
    data: { partsStatus: newStatus },
  })
}

// ── Parts chase: status, partial check-in, per-part timeline ──────────────────
const CHASE_STATUSES = ['NEED_TO_ORDER', 'ORDERED', 'BACKORDERED', 'PROBLEM', 'NOT_NEEDED']
const CHASE_LABEL = {
  NEED_TO_ORDER: 'Need to order', ORDERED: 'Ordered', BACKORDERED: 'Backordered',
  PROBLEM: 'Wrong / damaged — reordering', NOT_NEEDED: 'Not needed',
}
// ETA / order dates are date-only values stored at UTC midnight — format them in UTC
const fmtDay = (d) => new Date(d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
const sameDay = (a, b) => (!a && !b) || (a && b && new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10))
const toDay = (v) => (v ? new Date(String(v).slice(0, 10)) : null) // 'YYYY-MM-DD' or ISO → UTC midnight

async function logPartEvents(partId, events, username) {
  if (!events.length) return
  await prisma.partEvent.createMany({ data: events.map((e) => ({ partId, type: e.type, message: e.message, username })) })
}

// Applies a change to a part and records what changed on its timeline.
// body: qty, partNumber, description, dateOrdered, etaDate, finishStatus, hasCore, price, notes,
//       chaseStatus, isReceived (true = all here, false = none), qtyReceived (partial count)
async function applyPartUpdate(existing, body, username) {
  const { qty, partNumber, description, dateOrdered, etaDate, finishStatus, isReceived, qtyReceived, hasCore, price, notes, chaseStatus } = body
  const data = {}
  const events = []

  if (qty !== undefined) data.qty = Math.max(1, parseInt(qty) || 1)
  if (partNumber !== undefined) data.partNumber = partNumber
  if (description !== undefined) data.description = description
  if (finishStatus !== undefined) data.finishStatus = finishStatus
  if (hasCore !== undefined) data.hasCore = Boolean(hasCore)
  if (price !== undefined) data.price = price != null ? price : null

  if (dateOrdered !== undefined) {
    const v = toDay(dateOrdered)
    data.dateOrdered = v
    if (v && !sameDay(existing.dateOrdered, v)) events.push({ type: 'ORDERED', message: `Ordered ${fmtDay(v)}` })
  }
  if (etaDate !== undefined) {
    const v = toDay(etaDate)
    data.etaDate = v
    if (!sameDay(existing.etaDate, v)) events.push({ type: 'ETA', message: v ? `ETA ${fmtDay(v)}` : 'ETA cleared' })
  }
  if (chaseStatus !== undefined && CHASE_STATUSES.includes(chaseStatus) && chaseStatus !== existing.chaseStatus) {
    data.chaseStatus = chaseStatus
    events.push({ type: 'STATUS', message: CHASE_LABEL[chaseStatus] })
    if (chaseStatus === 'ORDERED' && !existing.dateOrdered && data.dateOrdered === undefined) {
      data.dateOrdered = toDay(new Date().toISOString())
      events.push({ type: 'ORDERED', message: `Ordered ${fmtDay(data.dateOrdered)}` })
    }
  }
  if (notes !== undefined) {
    const n = notes ? String(notes).trim() : ''
    data.notes = n || null
    if (n && n !== (existing.notes || '').trim()) events.push({ type: 'NOTE', message: n })
  }

  // Receiving: isReceived = all or nothing; qtyReceived = how many of qty are here
  const totalQty = data.qty ?? existing.qty
  let recv
  if (isReceived !== undefined) recv = isReceived ? totalQty : 0
  else if (qtyReceived !== undefined) recv = Math.max(0, Math.min(totalQty, parseInt(qtyReceived) || 0))
  if (recv !== undefined) {
    const allHere = recv >= totalQty
    data.qtyReceived = recv
    data.isReceived = allHere
    if (allHere && !existing.isReceived) {
      data.receivedAt = new Date()
      data.receivedBy = username
      events.push({ type: 'RECEIVED', message: totalQty > 1 ? `Checked in — all ${totalQty} here` : 'Checked in' })
    } else if (!allHere) {
      if (existing.isReceived) {
        data.receivedAt = null
        data.receivedBy = null
        events.push({ type: 'UNRECEIVED', message: 'Marked not here' })
      }
      if (recv > 0 && recv !== existing.qtyReceived) events.push({ type: 'PARTIAL', message: `${recv} of ${totalQty} here` })
    }
  }

  const part = await prisma.part.update({ where: { id: existing.id }, data, include: { photos: true } })
  await logPartEvents(existing.id, events, username)

  const receivedChanged = data.isReceived !== undefined && data.isReceived !== existing.isReceived
  if (receivedChanged || data.chaseStatus !== undefined) await syncROPartsStatus(existing.roId)
  if (receivedChanged) {
    await prisma.activityLog.create({
      data: {
        roId: existing.roId,
        eventType: 'PART_STATUS_CHANGED',
        message: `Part "${existing.description || existing.partNumber || existing.id}" ${part.isReceived ? 'received' : 'marked not received'}${username ? ` by ${username}` : ''}`,
      },
    })
  }
  return part
}

// GET /api/parts/still-out — every part not here yet on open ROs (excludes "not needed")
router.get('/still-out', requireAuth, async (req, res) => {
  try {
    const parts = await prisma.part.findMany({
      where: { isReceived: false, chaseStatus: { not: 'NOT_NEEDED' }, ro: { isArchived: false, noPartsRequired: false } },
      include: {
        ro: { select: { id: true, roNumber: true, vehicleYear: true, vehicleMake: true, vehicleModel: true, isBmw: true, vendor: { select: { id: true, name: true } } } },
        _count: { select: { photos: true, events: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    return res.json({ success: true, data: parts })
  } catch (err) {
    console.error('Still out error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/parts/:id/events — the part's timeline, newest first
router.get('/:id/events', requireAuth, async (req, res) => {
  try {
    const events = await prisma.partEvent.findMany({ where: { partId: parseInt(req.params.id) }, orderBy: { createdAt: 'desc' } })
    return res.json({ success: true, data: events })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/parts/:id/events — follow-up: { note?, etaDate?, chaseStatus? } in one step
router.post('/:id/events', requireAuth, async (req, res) => {
  try {
    const existing = await prisma.part.findUnique({ where: { id: parseInt(req.params.id) } })
    if (!existing) return res.status(404).json({ success: false, error: 'Part not found.' })
    const { note, etaDate, chaseStatus } = req.body || {}
    if (!note && etaDate === undefined && !chaseStatus) return res.status(400).json({ success: false, error: 'Add a note, ETA or status.' })
    const part = await applyPartUpdate(existing, { notes: note || undefined, etaDate, chaseStatus }, req.user?.username || null)
    const events = await prisma.partEvent.findMany({ where: { partId: existing.id }, orderBy: { createdAt: 'desc' } })
    return res.json({ success: true, data: { part, events } })
  } catch (err) {
    console.error('Part follow-up error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/parts/ro/:roId — add a part to an RO
router.post('/ro/:roId', requireAuth, async (req, res) => {
  const roId = parseInt(req.params.roId)
  const {
    qty,
    partNumber,
    description,
    dateOrdered,
    etaDate,
    finishStatus,
    isReceived,
    hasCore,
    price,
    alreadyOrdered, // false → starts as "Need to order"; anything else → Ordered today (default)
  } = req.body

  try {
    const ro = await prisma.rO.findUnique({ where: { id: roId } })
    if (!ro) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    const ordered = alreadyOrdered !== false
    const orderedOn = dateOrdered ? toDay(dateOrdered) : ordered ? toDay(new Date().toISOString()) : null
    const partQty = qty ? Math.max(1, parseInt(qty) || 1) : 1
    const part = await prisma.part.create({
      data: {
        roId,
        qty: partQty,
        partNumber: partNumber || null,
        description: description || null,
        dateOrdered: orderedOn,
        etaDate: etaDate ? toDay(etaDate) : null,
        chaseStatus: ordered ? 'ORDERED' : 'NEED_TO_ORDER',
        finishStatus: finishStatus || 'NO_FINISH_NEEDED',
        isReceived: Boolean(isReceived),
        qtyReceived: isReceived ? partQty : 0,
        hasCore: Boolean(hasCore),
        receivedAt: isReceived ? new Date() : null,
        receivedBy: isReceived ? req.user?.username || null : null,
        price: price != null ? price : null,
      },
      include: { photos: true },
    })
    await logPartEvents(part.id, [{ type: 'ADDED', message: ordered ? `Added — ordered ${fmtDay(orderedOn)}` : 'Added — needs ordering' }], req.user?.username || null)

    // If the part was created already received, sync RO status
    if (part.isReceived) {
      await syncROPartsStatus(roId)
    } else {
      // Any non-received part means MISSING
      await prisma.rO.update({
        where: { id: roId },
        data: { partsStatus: 'MISSING' },
      })
    }

    await prisma.activityLog.create({
      data: {
        roId,
        eventType: 'PART_ADDED',
        message: `Part added: ${description || partNumber || 'Unnamed'}`,
      },
    })

    return res.status(201).json({ success: true, data: part })
  } catch (err) {
    console.error('Add part error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/parts/bulk-received/:roId — mark all unrecieved parts on an RO as received
router.post('/bulk-received/:roId', requireAuth, async (req, res) => {
  const roId = parseInt(req.params.roId)
  const username = req.user?.username || 'unknown'

  try {
    const ro = await prisma.rO.findUnique({ where: { id: roId } })
    if (!ro) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    const pending = await prisma.part.findMany({ where: { roId, isReceived: false, chaseStatus: { not: 'NOT_NEEDED' } }, select: { id: true, qty: true } })
    for (const p of pending) {
      await prisma.part.update({ where: { id: p.id }, data: { isReceived: true, qtyReceived: p.qty, receivedAt: new Date(), receivedBy: username } })
    }
    if (pending.length) {
      await prisma.partEvent.createMany({ data: pending.map((p) => ({ partId: p.id, type: 'RECEIVED', message: 'Checked in (all parts marked received)', username })) })
    }
    const result = { count: pending.length }

    if (result.count > 0) {
      await syncROPartsStatus(roId)

      await prisma.activityLog.create({
        data: {
          roId,
          eventType: 'PARTS_BULK_RECEIVED',
          message: `All parts marked as received by ${username}`,
        },
      })
    }

    return res.json({ success: true, data: { count: result.count } })
  } catch (err) {
    console.error('Bulk received error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// PUT /api/parts/:id — update a part
router.put('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const existing = await prisma.part.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Part not found.' })
    }
    const part = await applyPartUpdate(existing, req.body || {}, req.user?.username || null)
    return res.json({ success: true, data: part })
  } catch (err) {
    console.error('Update part error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/parts/:id — delete a part
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const existing = await prisma.part.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Part not found.' })
    }

    await prisma.part.delete({ where: { id } })

    // Re-sync RO parts status after deletion
    await syncROPartsStatus(existing.roId)

    await prisma.activityLog.create({
      data: {
        roId: existing.roId,
        eventType: 'PART_DELETED',
        message: `Part deleted: ${existing.description || existing.partNumber || id}`,
      },
    })

    return res.json({ success: true, data: { message: 'Part deleted.' } })
  } catch (err) {
    console.error('Delete part error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/parts/ready-for-paint?days=7
// Parts with finishStatus=NEEDS_PAINT that were received within the last N days
// on non-archived ROs. Used by the Dashboard "Recent Ready for Paint" stat.
router.get('/ready-for-paint', requireAuth, async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 90)
  const since = new Date()
  since.setDate(since.getDate() - (days - 1))
  since.setHours(0, 0, 0, 0)

  try {
    const parts = await prisma.part.findMany({
      where: {
        finishStatus: 'NEEDS_PAINT',
        isReceived: true,
        receivedAt: { gte: since },
        ro: { isArchived: false },
      },
      select: {
        id: true,
        description: true,
        partNumber: true,
        receivedAt: true,
        ro: { select: { id: true, roNumber: true, vehicleMake: true, vehicleModel: true } },
      },
      orderBy: { receivedAt: 'desc' },
    })

    return res.json({ success: true, data: parts })
  } catch (err) {
    console.error('Ready for paint error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/parts/:id/photos — upload a photo for a part
router.post('/:id/photos', requireAuth, photoUpload.single('file'), async (req, res) => {
  const id = parseInt(req.params.id)

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' })
  }

  try {
    const part = await prisma.part.findUnique({ where: { id } })
    if (!part) {
      await fileStore.discard(req.file)
      return res.status(404).json({ success: false, error: 'Part not found.' })
    }

    await fileStore.save(req.file, 'parts')
    const photo = await prisma.partPhoto.create({
      data: {
        partId: id,
        originalFilename: req.file.originalname,
        storedPath: req.file.filename,
      },
    })

    return res.status(201).json({ success: true, data: photo })
  } catch (err) {
    console.error('Upload part photo error:', err)
    await fileStore.discard(req.file)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/parts/:id/photos — list photos for a part
router.get('/:id/photos', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const photos = await prisma.partPhoto.findMany({
      where: { partId: id },
      orderBy: { createdAt: 'asc' },
    })
    return res.json({ success: true, data: photos })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/parts/photos/:photoId/file — serve photo file
router.get('/photos/:photoId/file', requireAuth, async (req, res) => {
  const photoId = parseInt(req.params.photoId)
  try {
    const photo = await prisma.partPhoto.findUnique({ where: { id: photoId } })
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found.' })
    }
    const found = await fileStore.send(req, res, `parts/${photo.storedPath}`, { filename: photo.originalFilename || photo.storedPath })
    if (!found) return res.status(404).json({ success: false, error: 'File not found.' })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/parts/photos/:photoId — delete a photo
router.delete('/photos/:photoId', requireAuth, async (req, res) => {
  const photoId = parseInt(req.params.photoId)
  try {
    const photo = await prisma.partPhoto.findUnique({ where: { id: photoId } })
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found.' })
    }
    await prisma.partPhoto.delete({ where: { id: photoId } })
    await fileStore.remove(`parts/${photo.storedPath}`)
    return res.json({ success: true, data: { message: 'Photo deleted.' } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
