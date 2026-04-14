const express = require('express')
const multer = require('multer')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// Memory storage — we parse and discard, never write to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

// CCC ONE make abbreviation map
const MAKE_MAP = {
  PORS: 'Porsche', HOND: 'Honda', TOYT: 'Toyota', CHEV: 'Chevrolet', FORD: 'Ford',
  NISS: 'Nissan', DODG: 'Dodge', SUBA: 'Subaru', MERZ: 'Mercedes-Benz', AUDI: 'Audi',
  VOLK: 'Volkswagen', HYUN: 'Hyundai', JEEP: 'Jeep', RAM: 'Ram', KIA: 'Kia', BMW: 'BMW',
  MITS: 'Mitsubishi', MZDA: 'Mazda', VOLV: 'Volvo', ACUR: 'Acura', INFI: 'Infiniti',
  LEXS: 'Lexus', CADI: 'Cadillac', BUIC: 'Buick', GMC: 'GMC', LINC: 'Lincoln',
  CHRY: 'Chrysler', FIAT: 'Fiat', MINI: 'MINI', LAND: 'Land Rover', JAGR: 'Jaguar',
}

// CCC ONE Parts List column x-ranges (points from left margin)
const COLS = {
  LINE:  [24, 70],
  DESC:  [70, 315],
  PART:  [315, 430],
  QTY:   [430, 490],
  PRICE: [490, 620],
}

function getCol(x) {
  for (const [name, [lo, hi]] of Object.entries(COLS)) {
    if (x >= lo && x < hi) return name
  }
  return null
}

async function parseCCCPDF(buffer) {
  const pdfParse = require('pdf-parse')
  const rawItems = []

  // Collect individual text items with their x,y positions
  function renderPage(pageData) {
    return pageData.getTextContent().then((tc) => {
      tc.items.forEach((item) => {
        rawItems.push({
          text: item.str,
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]),
        })
      })
      return ''
    })
  }

  await pdfParse(buffer, { pagerender: renderPage })

  // Sort top-to-bottom (desc y), then left-to-right (asc x)
  rawItems.sort((a, b) => b.y - a.y || a.x - b.x)

  // Group into rows by y-position (3pt tolerance)
  const rows = []
  let curRow = [], curY = null
  for (const item of rawItems) {
    if (curY === null || Math.abs(item.y - curY) > 3) {
      curRow = []
      rows.push(curRow)
      curY = item.y
    }
    curRow.push(item)
  }

  let roNumber = null, vehicleYear = null, vehicleMake = null, vehicleModel = null, vin = null
  let inTable = false
  const parts = []

  for (const row of rows) {
    const joined = row.map((i) => i.text).join(' ').trim()
    if (!joined) continue

    // RO Number (explicit label or encoded in customer code P..XX-YY → XXYY)
    if (!roNumber) {
      const roM = joined.match(/RO Number:\s*(\d+)/)
      if (roM) roNumber = roM[1]
      else {
        const custM = joined.match(/(?:Customer|Owner):\s*P\.\.(\d+)-(\d+)/)
        if (custM) roNumber = custM[1] + custM[2]
      }
    }

    // VIN
    if (!vin) {
      const vinM = joined.match(/VIN:\s*([A-HJ-NPR-Z0-9]{17})/)
      if (vinM) vin = vinM[1]
    }

    // Vehicle info: "YYYY MAKE Model AWD 4D ..."
    if (!vehicleYear) {
      const vehM = joined.match(
        /^(\d{4})\s+([A-Z]{2,5})\s+(.+?)(?:\s+\d+D\s|\s+AWD\b|\s+FWD\b|\s+4WD\b|\s+RWD\b|$)/
      )
      if (vehM) {
        vehicleYear = vehM[1]
        vehicleMake = MAKE_MAP[vehM[2]] || vehM[2]
        vehicleModel = vehM[3].trim()
      }
    }

    // Table header row
    if (joined.includes('Part Number') || joined.includes('Line   Description')) {
      inTable = true
      continue
    }

    if (!inTable) continue

    // Footer (date line) signals end of table
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(joined)) break

    // Only include rows that have data in Part Number or Price column
    const hasPart  = row.some((i) => getCol(i.x) === 'PART')
    const hasPrice = row.some((i) => getCol(i.x) === 'PRICE')
    if (!hasPart && !hasPrice) continue // section header row (REAR BUMPER, FRONT DOOR, etc.)

    // Aggregate text by column
    const byCol = {}
    for (const item of row) {
      const c = getCol(item.x)
      if (c) byCol[c] = (byCol[c] || '') + item.text
    }

    const description = (byCol.DESC  || '').trim()
    const partNumber  = (byCol.PART  || '').trim()
    const qty         = parseInt(byCol.QTY || '1') || 1
    const price       = byCol.PRICE ? parseFloat(byCol.PRICE) || null : null

    if (description || partNumber) {
      parts.push({ description, partNumber: partNumber || null, qty, price })
    }
  }

  return { roNumber, vin, vehicleYear, vehicleMake, vehicleModel, parts }
}

// POST /api/import/parse
router.post('/parse', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' })
  }

  const isPDF =
    req.file.mimetype === 'application/pdf' ||
    req.file.originalname.toLowerCase().endsWith('.pdf')

  if (!isPDF) {
    return res.status(400).json({ success: false, error: 'Only PDF files are supported.' })
  }

  try {
    const result = await parseCCCPDF(req.file.buffer)

    if (!result.parts || result.parts.length === 0) {
      return res.status(422).json({
        success: false,
        error: 'No parts found. Make sure this is a CCC ONE Parts List PDF.',
      })
    }

    return res.json({ success: true, data: result })
  } catch (err) {
    console.error('Import parse error:', err)
    return res.status(500).json({ success: false, error: 'Failed to read PDF: ' + err.message })
  }
})

module.exports = router
