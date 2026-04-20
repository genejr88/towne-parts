const express = require('express')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const PRIVATE_PIN = process.env.PRIVATE_PIN || 'TowneBMW2025'

const privateDir = path.join(__dirname, '../../uploads/private')
if (!fs.existsSync(privateDir)) fs.mkdirSync(privateDir, { recursive: true })

const privateUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, privateDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ''
      cb(null, `priv-${Date.now()}${ext}`)
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
})

function requirePin(req, res, next) {
  const pin = req.headers['x-private-pin'] || req.query.pin
  if (!pin || pin !== PRIVATE_PIN) {
    return res.status(403).json({ success: false, error: 'Access denied.' })
  }
  next()
}

const router = express.Router()

// POST /api/private/verify — check PIN
router.post('/verify', requireAuth, (req, res) => {
  const { pin } = req.body
  if (pin === PRIVATE_PIN) {
    return res.json({ success: true })
  }
  return res.status(403).json({ success: false, error: 'Invalid PIN.' })
})

// GET /api/private/files — list all private files
router.get('/files', requireAuth, requirePin, async (req, res) => {
  try {
    const files = await prisma.privateFile.findMany({ orderBy: { createdAt: 'desc' } })
    return res.json({ success: true, data: files })
  } catch (err) {
    console.error('List private files error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/private/upload — upload a private file
router.post('/upload', requireAuth, requirePin, privateUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded.' })
  try {
    const file = await prisma.privateFile.create({
      data: {
        storedPath: req.file.filename,
        originalFilename: req.file.originalname,
        caption: req.body?.caption || null,
      },
    })
    return res.status(201).json({ success: true, data: file })
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    console.error('Private upload error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/private/files/:id/view — serve the file (PIN via query or header)
router.get('/files/:id/view', requireAuth, requirePin, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const file = await prisma.privateFile.findUnique({ where: { id } })
    if (!file) return res.status(404).json({ success: false, error: 'File not found.' })

    const filePath = path.join(privateDir, file.storedPath)
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File missing on disk.' })

    return res.sendFile(filePath)
  } catch (err) {
    console.error('View private file error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/private/files/:id — delete a private file
router.delete('/files/:id', requireAuth, requirePin, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const file = await prisma.privateFile.findUnique({ where: { id } })
    if (!file) return res.status(404).json({ success: false, error: 'File not found.' })

    const filePath = path.join(privateDir, file.storedPath)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)

    await prisma.privateFile.delete({ where: { id } })
    return res.json({ success: true, data: { id } })
  } catch (err) {
    console.error('Delete private file error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
