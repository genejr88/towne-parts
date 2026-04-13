const express = require('express')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

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
    select: { isReceived: true },
  })

  if (parts.length === 0) return

  const allReceived = parts.every((p) => p.isReceived)

  const newStatus = allReceived ? 'ALL_HERE' : 'MISSING'

  await prisma.rO.update({
    where: { id: roId },
    data: { partsStatus: newStatus },
  })
}

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
  } = req.body

  try {
    const ro = await prisma.rO.findUnique({ where: { id: roId } })
    if (!ro) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    const part = await prisma.part.create({
      data: {
        roId,
        qty: qty ? parseInt(qty) : 1,
        partNumber: partNumber || null,
        description: description || null,
        dateOrdered: dateOrdered ? new Date(dateOrdered) : null,
        etaDate: etaDate ? new Date(etaDate) : null,
        finishStatus: finishStatus || 'NO_FINISH_NEEDED',
        isReceived: Boolean(isReceived),
        hasCore: Boolean(hasCore),
        receivedAt: isReceived ? new Date() : null,
        price: price != null ? price : null,
      },
      include: { photos: true },
    })

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

// PUT /api/parts/:id — update a part
router.put('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)
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
  } = req.body

  try {
    const existing = await prisma.part.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Part not found.' })
    }

    const updateData = {}
    if (qty !== undefined) updateData.qty = parseInt(qty)
    if (partNumber !== undefined) updateData.partNumber = partNumber
    if (description !== undefined) updateData.description = description
    if (dateOrdered !== undefined) updateData.dateOrdered = dateOrdered ? new Date(dateOrdered) : null
    if (etaDate !== undefined) updateData.etaDate = etaDate ? new Date(etaDate) : null
    if (finishStatus !== undefined) updateData.finishStatus = finishStatus
    if (hasCore !== undefined) updateData.hasCore = Boolean(hasCore)
    if (price !== undefined) updateData.price = price != null ? price : null

    // Handle received status change
    if (isReceived !== undefined) {
      const nowReceived = Boolean(isReceived)
      updateData.isReceived = nowReceived
      if (nowReceived && !existing.isReceived) {
        updateData.receivedAt = new Date()
      } else if (!nowReceived) {
        updateData.receivedAt = null
      }
    }

    const part = await prisma.part.update({
      where: { id },
      data: updateData,
      include: { photos: true },
    })

    // Sync RO partsStatus when received flag changed
    if (isReceived !== undefined) {
      await syncROPartsStatus(existing.roId)

      const statusLabel = part.isReceived ? 'received' : 'marked not received'
      await prisma.activityLog.create({
        data: {
          roId: existing.roId,
          eventType: 'PART_STATUS_CHANGED',
          message: `Part "${existing.description || existing.partNumber || id}" ${statusLabel}`,
        },
      })
    }

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

// POST /api/parts/:id/photos — upload a photo for a part
router.post('/:id/photos', requireAuth, photoUpload.single('file'), async (req, res) => {
  const id = parseInt(req.params.id)

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' })
  }

  try {
    const part = await prisma.part.findUnique({ where: { id } })
    if (!part) {
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ success: false, error: 'Part not found.' })
    }

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
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
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
    const filePath = path.join(partsPhotosDir, photo.storedPath)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found on disk.' })
    }
    res.setHeader('Content-Disposition', `inline; filename="${photo.originalFilename || photo.storedPath}"`)
    return res.sendFile(filePath)
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
    const filePath = path.join(partsPhotosDir, photo.storedPath)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return res.json({ success: true, data: { message: 'Photo deleted.' } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
