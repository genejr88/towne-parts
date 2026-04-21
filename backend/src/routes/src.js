const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// ── Multer setup for SRC invoice photos ───────────────────────────────────────
const uploadsDir = path.join(__dirname, '../../uploads/src')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `src-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.pdf']
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, allowed.includes(ext))
  },
})

// Helper — full include shape
const SRC_INCLUDE = {
  ro: { select: { id: true, roNumber: true, vehicleYear: true, vehicleMake: true, vehicleModel: true } },
  photos: true,
}

// ── GET /api/src/public — public live link (no auth) ─────────────────────────
router.get('/public', async (_req, res) => {
  try {
    const entries = await prisma.sRCEntry.findMany({
      where: { status: 'OPEN' },
      include: SRC_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })
    return res.json({ success: true, data: entries })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

// ── GET /api/src — list all (authenticated) ───────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { status } = req.query
  const where = {}
  if (status === 'open') where.status = 'OPEN'
  else if (status === 'completed') where.status = 'COMPLETED'

  try {
    const entries = await prisma.sRCEntry.findMany({
      where,
      include: SRC_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })
    return res.json({ success: true, data: entries })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

// ── POST /api/src — create standalone SRC entry (roId optional) ───────────────
router.post('/', requireAuth, async (req, res) => {
  const { entryType, note, partNumber, partDescription, vendorName, returnDate, roId } = req.body

  if (!entryType) return res.status(400).json({ success: false, error: 'entryType is required.' })
  if (!['RETURN', 'CORE_RETURN'].includes(entryType))
    return res.status(400).json({ success: false, error: 'entryType must be RETURN or CORE_RETURN.' })

  try {
    let resolvedRoId = null
    if (roId) {
      const parsedId = parseInt(roId)
      const ro = await prisma.rO.findUnique({ where: { id: parsedId } })
      if (!ro) return res.status(404).json({ success: false, error: 'RO not found.' })
      resolvedRoId = parsedId
    }

    const entry = await prisma.sRCEntry.create({
      data: {
        roId: resolvedRoId,
        entryType,
        note: note || null,
        partNumber: partNumber || null,
        partDescription: partDescription || null,
        vendorName: vendorName || null,
        returnDate: returnDate ? new Date(returnDate) : null,
        createdBy: req.user.username,
        status: 'OPEN',
      },
      include: SRC_INCLUDE,
    })

    if (resolvedRoId) {
      await prisma.activityLog.create({
        data: {
          roId: resolvedRoId,
          eventType: 'SRC_CREATED',
          message: `SRC entry created: ${entryType}${note ? ` — ${note}` : ''} by ${req.user.username}`,
        },
      })
    }

    return res.status(201).json({ success: true, data: entry })
  } catch (err) {
    console.error('Create SRC entry error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// ── POST /api/src/ro/:roId — create RO-linked SRC (backward compat) ───────────
router.post('/ro/:roId', requireAuth, async (req, res) => {
  const roId = parseInt(req.params.roId)
  const { entryType, note, partNumber, partDescription, vendorName, returnDate } = req.body

  if (!entryType) return res.status(400).json({ success: false, error: 'entryType is required.' })
  if (!['RETURN', 'CORE_RETURN'].includes(entryType))
    return res.status(400).json({ success: false, error: 'entryType must be RETURN or CORE_RETURN.' })

  try {
    const ro = await prisma.rO.findUnique({ where: { id: roId } })
    if (!ro) return res.status(404).json({ success: false, error: 'RO not found.' })

    const entry = await prisma.sRCEntry.create({
      data: {
        roId,
        entryType,
        note: note || null,
        partNumber: partNumber || null,
        partDescription: partDescription || null,
        vendorName: vendorName || null,
        returnDate: returnDate ? new Date(returnDate) : null,
        createdBy: req.user.username,
        status: 'OPEN',
      },
      include: SRC_INCLUDE,
    })

    await prisma.activityLog.create({
      data: {
        roId,
        eventType: 'SRC_CREATED',
        message: `SRC entry created: ${entryType}${note ? ` — ${note}` : ''} by ${req.user.username}`,
      },
    })

    return res.status(201).json({ success: true, data: entry })
  } catch (err) {
    console.error('Create SRC entry error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// ── POST /api/src/:id/photos — upload invoice photos ─────────────────────────
router.post('/:id/photos', requireAuth, upload.array('photos', 10), async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const existing = await prisma.sRCEntry.findUnique({ where: { id } })
    if (!existing) {
      req.files?.forEach((f) => { try { fs.unlinkSync(f.path) } catch {} })
      return res.status(404).json({ success: false, error: 'SRC entry not found.' })
    }
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ success: false, error: 'No files uploaded.' })

    const photos = await Promise.all(
      req.files.map((f) =>
        prisma.sRCPhoto.create({
          data: { srcEntryId: id, storedPath: f.filename, originalFilename: f.originalname },
        })
      )
    )
    return res.status(201).json({ success: true, data: photos })
  } catch (err) {
    req.files?.forEach((f) => { try { fs.unlinkSync(f.path) } catch {} })
    console.error('SRC photo upload error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// ── DELETE /api/src/photos/:photoId — delete a photo ─────────────────────────
router.delete('/photos/:photoId', requireAuth, async (req, res) => {
  const photoId = parseInt(req.params.photoId)
  try {
    const photo = await prisma.sRCPhoto.findUnique({ where: { id: photoId } })
    if (!photo) return res.status(404).json({ success: false, error: 'Photo not found.' })
    try { fs.unlinkSync(path.join(uploadsDir, photo.storedPath)) } catch {}
    await prisma.sRCPhoto.delete({ where: { id: photoId } })
    return res.json({ success: true, data: { message: 'Photo deleted.' } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

// ── PUT /api/src/:id — update status / fields ─────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)
  const { status, note, partNumber, partDescription, vendorName, returnDate } = req.body

  try {
    const existing = await prisma.sRCEntry.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ success: false, error: 'SRC entry not found.' })

    if (status && !['OPEN', 'COMPLETED'].includes(status))
      return res.status(400).json({ success: false, error: 'Invalid status.' })

    const updateData = {}
    if (note !== undefined) updateData.note = note
    if (partNumber !== undefined) updateData.partNumber = partNumber
    if (partDescription !== undefined) updateData.partDescription = partDescription
    if (vendorName !== undefined) updateData.vendorName = vendorName
    if (returnDate !== undefined) updateData.returnDate = returnDate ? new Date(returnDate) : null
    if (status !== undefined) {
      updateData.status = status
      if (status === 'COMPLETED' && existing.status !== 'COMPLETED') updateData.completedAt = new Date()
      else if (status === 'OPEN') updateData.completedAt = null
    }

    const entry = await prisma.sRCEntry.update({ where: { id }, data: updateData, include: SRC_INCLUDE })

    if (status && status !== existing.status && existing.roId) {
      await prisma.activityLog.create({
        data: {
          roId: existing.roId,
          eventType: 'SRC_STATUS_CHANGED',
          message: `SRC entry (${existing.entryType}) marked ${status} by ${req.user.username}`,
        },
      })
    }

    return res.json({ success: true, data: entry })
  } catch (err) {
    console.error('Update SRC entry error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// ── DELETE /api/src/:id — delete entry ───────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const existing = await prisma.sRCEntry.findUnique({ where: { id }, include: { photos: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'SRC entry not found.' })

    existing.photos.forEach((p) => { try { fs.unlinkSync(path.join(uploadsDir, p.storedPath)) } catch {} })
    await prisma.sRCEntry.delete({ where: { id } })

    if (existing.roId) {
      await prisma.activityLog.create({
        data: {
          roId: existing.roId,
          eventType: 'SRC_DELETED',
          message: `SRC entry (${existing.entryType}) deleted by ${req.user.username}`,
        },
      })
    }

    return res.json({ success: true, data: { message: 'SRC entry deleted.' } })
  } catch (err) {
    console.error('Delete SRC entry error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
