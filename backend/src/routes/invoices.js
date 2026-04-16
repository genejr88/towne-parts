const express = require('express')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// Ensure uploads/invoices directory exists
const invoicesDir = path.join(__dirname, '../../uploads/invoices')
if (!fs.existsSync(invoicesDir)) {
  fs.mkdirSync(invoicesDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, invoicesDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
    const ext = path.extname(file.originalname)
    cb(null, `invoice-${unique}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.bmp']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowed.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error(`File type not allowed: ${ext}`))
    }
  },
})

// POST /api/invoices/ro/:roId — upload invoice file
router.post('/ro/:roId', requireAuth, upload.single('file'), async (req, res) => {
  const roId = parseInt(req.params.roId)

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' })
  }

  try {
    const ro = await prisma.rO.findUnique({ where: { id: roId } })
    if (!ro) {
      // Clean up the uploaded file
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    const invoice = await prisma.rOInvoice.create({
      data: {
        roId,
        originalFilename: req.file.originalname,
        storedPath: req.file.filename,
        uploadedBy: req.user.username,
      },
    })

    await prisma.activityLog.create({
      data: {
        roId,
        eventType: 'INVOICE_UPLOADED',
        message: `Invoice uploaded: ${req.file.originalname} by ${req.user.username}`,
      },
    })

    return res.status(201).json({ success: true, data: invoice })
  } catch (err) {
    console.error('Upload invoice error:', err)
    // Clean up file on DB error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/invoices/ro/:roId — list invoices for an RO
router.get('/ro/:roId', requireAuth, async (req, res) => {
  const roId = parseInt(req.params.roId)

  try {
    const invoices = await prisma.rOInvoice.findMany({
      where: { roId },
      orderBy: { createdAt: 'desc' },
    })

    return res.json({ success: true, data: invoices })
  } catch (err) {
    console.error('List invoices error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/invoices/:id/file — serve the invoice file (no auth: browser <a> tags can't send headers)
router.get('/:id/file', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const invoice = await prisma.rOInvoice.findUnique({ where: { id } })
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found.' })
    }

    const filePath = path.join(invoicesDir, invoice.storedPath)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found on disk.' })
    }

    res.setHeader('Content-Disposition', `inline; filename="${invoice.originalFilename || invoice.storedPath}"`)
    return res.sendFile(filePath)
  } catch (err) {
    console.error('Serve invoice file error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/invoices/:id — remove invoice record and file
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const invoice = await prisma.rOInvoice.findUnique({ where: { id } })
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found.' })
    }

    // Delete from DB first
    await prisma.rOInvoice.delete({ where: { id } })

    // Remove file from disk
    const filePath = path.join(invoicesDir, invoice.storedPath)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    await prisma.activityLog.create({
      data: {
        roId: invoice.roId,
        eventType: 'INVOICE_DELETED',
        message: `Invoice deleted: ${invoice.originalFilename || invoice.storedPath}`,
      },
    })

    return res.json({ success: true, data: { message: 'Invoice deleted.' } })
  } catch (err) {
    console.error('Delete invoice error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
