const express = require('express')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// ── Photo upload setup ────────────────────────────────────────────────────────
const inventoryPhotosDir = path.join(__dirname, '../../uploads/inventory')
if (!fs.existsSync(inventoryPhotosDir)) {
  fs.mkdirSync(inventoryPhotosDir, { recursive: true })
}

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, inventoryPhotosDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
    const ext = path.extname(file.originalname)
    cb(null, `inv-${unique}${ext}`)
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

// GET /api/inventory — list all inventory parts (with optional ?search=)
router.get('/', requireAuth, async (req, res) => {
  const { search } = req.query

  try {
    const where = search
      ? {
          OR: [
            { partNumber: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}

    const parts = await prisma.inventoryPart.findMany({
      where,
      include: { photos: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    })

    return res.json({ success: true, data: parts })
  } catch (err) {
    console.error('List inventory error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/inventory — create inventory part
router.post('/', requireAuth, async (req, res) => {
  const { partNumber, description, qty, notes } = req.body

  if (!description) {
    return res.status(400).json({ success: false, error: 'Description is required.' })
  }

  try {
    const part = await prisma.inventoryPart.create({
      data: {
        partNumber: partNumber || null,
        description,
        qty: qty ? parseInt(qty) : 1,
        notes: notes || null,
      },
      include: { photos: true },
    })

    return res.status(201).json({ success: true, data: part })
  } catch (err) {
    console.error('Create inventory part error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// PUT /api/inventory/:id — update inventory part
router.put('/:id', requireAuth, async (req, res) => {
  const { id } = req.params
  const { partNumber, description, qty, notes } = req.body

  try {
    const existing = await prisma.inventoryPart.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Inventory part not found.' })
    }

    const updateData = {}
    if (partNumber !== undefined) updateData.partNumber = partNumber || null
    if (description !== undefined) updateData.description = description
    if (qty !== undefined) updateData.qty = parseInt(qty)
    if (notes !== undefined) updateData.notes = notes || null

    const part = await prisma.inventoryPart.update({
      where: { id },
      data: updateData,
      include: { photos: { orderBy: { createdAt: 'asc' } } },
    })

    return res.json({ success: true, data: part })
  } catch (err) {
    console.error('Update inventory part error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/inventory/:id — delete inventory part (cascade deletes photos via DB)
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params

  try {
    const existing = await prisma.inventoryPart.findUnique({
      where: { id },
      include: { photos: true },
    })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Inventory part not found.' })
    }

    // Delete photo files from disk before DB delete
    for (const photo of existing.photos) {
      const filePath = path.join(inventoryPhotosDir, photo.storedPath)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    }

    await prisma.inventoryPart.delete({ where: { id } })

    return res.json({ success: true, data: { message: 'Inventory part deleted.' } })
  } catch (err) {
    console.error('Delete inventory part error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/inventory/:id/photos — upload photo for an inventory part
router.post('/:id/photos', requireAuth, photoUpload.single('photo'), async (req, res) => {
  const { id } = req.params

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' })
  }

  try {
    const part = await prisma.inventoryPart.findUnique({ where: { id } })
    if (!part) {
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ success: false, error: 'Inventory part not found.' })
    }

    const photo = await prisma.inventoryPartPhoto.create({
      data: {
        inventoryPartId: id,
        originalFilename: req.file.originalname,
        storedPath: req.file.filename,
      },
    })

    return res.status(201).json({ success: true, data: photo })
  } catch (err) {
    console.error('Upload inventory photo error:', err)
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/inventory/photos/:photoId/file — serve photo file (no auth required)
router.get('/photos/:photoId/file', async (req, res) => {
  const { photoId } = req.params
  try {
    const photo = await prisma.inventoryPartPhoto.findUnique({ where: { id: photoId } })
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found.' })
    }
    const filePath = path.join(inventoryPhotosDir, photo.storedPath)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found on disk.' })
    }
    res.setHeader('Content-Disposition', `inline; filename="${photo.originalFilename || photo.storedPath}"`)
    return res.sendFile(filePath)
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/inventory/photos/:photoId — delete a photo record + file
router.delete('/photos/:photoId', requireAuth, async (req, res) => {
  const { photoId } = req.params
  try {
    const photo = await prisma.inventoryPartPhoto.findUnique({ where: { id: photoId } })
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found.' })
    }
    await prisma.inventoryPartPhoto.delete({ where: { id: photoId } })
    const filePath = path.join(inventoryPhotosDir, photo.storedPath)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return res.json({ success: true, data: { message: 'Photo deleted.' } })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
