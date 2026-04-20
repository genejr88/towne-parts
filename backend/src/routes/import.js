const express = require('express')
const multer = require('multer')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// Memory storage — we parse and discard, never write to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

// CCC ONE make abbreviation map — ONLY recognized codes match as vehicle lines
const MAKE_MAP = {
  PORS: 'Porsche', HOND: 'Honda', TOYT: 'Toyota', CHEV: 'Chevrolet', FORD: 'Ford',
  NISS: 'Nissan', DODG: 'Dodge', SUBA: 'Subaru', MERZ: 'Mercedes-Benz', AUDI: 'Audi',
  VOLK: 'Volkswagen', HYUN: 'Hyundai', JEEP: 'Jeep', RAM: 'Ram', KIA: 'Kia', BMW: 'BMW',
  MITS: 'Mitsubishi', MZDA: 'Mazda', VOLV: 'Volvo', ACUR: 'Acura', INFI: 'Infiniti',
  LEXS: 'Lexus', CADI: 'Cadillac', BUIC: 'Buick', GMC: 'GMC', LINC: 'Lincoln',
  CHRY: 'Chrysler', FIAT: 'Fiat', MINI: 'MINI', LAND: 'Land Rover', JAGR: 'Jaguar',
  PONT: 'Pontiac', OLDS: 'Oldsmobile', SATU: 'Saturn', ISZU: 'Isuzu', SUZK: 'Suzuki',
  TESL: 'Tesla', ALFA: 'Alfa Romeo', GNSS: 'Genesis', HUMD: 'Hummer', PLYM: 'Plymouth',
  SCIN: 'Scion', SMRT: 'Smart', STRN: 'Saturn', RIVN: 'Rivian', LCVR: 'Land Cruiser',
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

  // Collect individual text items with their x,y positions.
  // Offset y by page index so multi-page PDFs sort correctly (page 1 items
  // have higher y than page 2 items, preserving top-to-bottom reading order).
  let pageIndex = 0
  function renderPage(pageData) {
    const pg = pageIndex++
    return pageData.getTextContent().then((tc) => {
      tc.items.forEach((item) => {
        rawItems.push({
          text: item.str,
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]) - pg * 10000,
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
        /^(\d{4})\s+([A-Z]{2,5})\s+(.+?)(?:\s+\d+D\b|\s+AWD\b|\s+FWD\b|\s+4WD\b|\s+RWD\b|$)/
      )
      if (vehM && MAKE_MAP[vehM[2]]) {
        vehicleYear = vehM[1]
        vehicleMake = MAKE_MAP[vehM[2]]
        vehicleModel = vehM[3].trim()
      }
    }

    // Table header row
    if (joined.includes('Part Number') || joined.includes('Line   Description')) {
      inTable = true
      continue
    }

    if (!inTable) continue

    // Footer (date line) — skip and reset so next page's header re-enables table
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(joined)) { inTable = false; continue }

    // Only include rows that have data in Part Number or Price column
    const hasPart  = row.some((i) => getCol(i.x) === 'PART')
    const hasPrice = row.some((i) => getCol(i.x) === 'PRICE')
    const byCol = {}
    for (const item of row) {
      const c = getCol(item.x)
      if (c) byCol[c] = (byCol[c] || '') + item.text
    }

    // Wrapped description continuation (e.g. tire spec on second line: "111H")
    // Detected by: has DESC text, no PART/PRICE, no LINE number
    if (!hasPart && !hasPrice && byCol.DESC && !byCol.LINE && parts.length > 0) {
      parts[parts.length - 1].description += ' ' + byCol.DESC.trim()
      continue
    }

    if (!hasPart && !hasPrice) continue // section header (REAR BUMPER, FRONT DOOR, etc.)

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

// ── Text-based CCC ONE parser (for OCR output — no x/y coords) ───────────────
// Reuses the same regexes as parseCCCPDF but works on raw newline-delimited text.
function parseCCCText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  let roNumber = null, vehicleYear = null, vehicleMake = null, vehicleModel = null, vin = null
  let inTable = false
  const parts = []

  for (const line of lines) {
    // RO Number
    if (!roNumber) {
      const roM = line.match(/RO\s*(?:Number|#|No\.?)[\s:]*(\d+)/i)
      if (roM) roNumber = roM[1]
      else {
        const custM = line.match(/(?:Customer|Owner):\s*P\.\.(\d+)-(\d+)/i)
        if (custM) roNumber = custM[1] + custM[2]
      }
    }

    // VIN
    if (!vin) {
      const vinM = line.match(/VIN[\s:]*([A-HJ-NPR-Z0-9]{17})/i)
      if (vinM) vin = vinM[1]
    }

    // Vehicle: "YYYY MAKE Model ..." — only match if make is a known CCC code
    if (!vehicleYear) {
      const vehM = line.match(
        /^(\d{4})\s+([A-Z]{2,5})\s+(.+?)(?:\s+\d+D\b|\s+AWD\b|\s+FWD\b|\s+4WD\b|\s+RWD\b|$)/
      )
      if (vehM && MAKE_MAP[vehM[2]]) {
        vehicleYear = vehM[1]
        vehicleMake = MAKE_MAP[vehM[2]]
        vehicleModel = vehM[3].trim()
      }
    }

    // Table header
    if (/Part\s*Number|Line\s+Description/i.test(line)) {
      inTable = true
      continue
    }

    // Footer date line — reset so next page re-enables table
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(line)) { inTable = false; continue }

    if (!inTable) continue

    // Skip section headers (all caps, short, no digits) e.g. "REAR BUMPER"
    if (/^[A-Z\s\/\-]{4,}$/.test(line) && !/\d/.test(line)) continue

    // CCC ONE parts lines look like:
    //   "1  Front Bumper Cover  12345-AB  1  299.50"
    //   or "1  Front Bumper Cover  12345-AB"
    // We try to parse: [lineNum] description [partNum] [qty] [price]
    // A relaxed approach: split on 2+ spaces to get columns
    const cols = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean)

    if (cols.length < 2) continue

    // Try to detect and extract price (last token if it's a number)
    let price = null
    let lastCol = cols[cols.length - 1]
    const priceM = lastCol.match(/^\$?([\d,]+\.\d{2})$/)
    if (priceM) {
      price = parseFloat(priceM[1].replace(/,/g, ''))
      cols.pop()
      lastCol = cols[cols.length - 1]
    }

    // Try to detect qty (last remaining token if it's a small integer 1-99)
    let qty = 1
    const qtyM = lastCol.match(/^(\d{1,2})$/)
    if (qtyM && cols.length > 2) {
      qty = parseInt(qtyM[1]) || 1
      cols.pop()
    }

    // Try to detect line number (first token if it's a small integer)
    if (cols.length > 0 && /^\d{1,3}$/.test(cols[0])) cols.shift()

    if (cols.length === 0) continue

    // Remaining: description + optional part number (part numbers usually alphanumeric with dashes)
    // Heuristic: if last column looks like a part number (contains digit + letter or dash), split it off
    let description = ''
    let partNumber = null

    const possiblePart = cols[cols.length - 1]
    const looksLikePart = cols.length > 1 && /^[A-Z0-9][A-Z0-9\-]{3,}$/i.test(possiblePart) && /\d/.test(possiblePart)
    if (looksLikePart) {
      partNumber = possiblePart
      description = cols.slice(0, -1).join(' ')
    } else {
      description = cols.join(' ')
    }

    description = description.trim()
    if (description || partNumber) {
      parts.push({ description, partNumber: partNumber || null, qty, price })
    }
  }

  return { roNumber, vin, vehicleYear, vehicleMake, vehicleModel, parts }
}

// ── Lenient fallback parser — no header needed ────────────────────────────────
// Scans every line for anything that looks like a part: has a description
// and optionally a part number / price. Used when the strict parser finds nothing.
function parseCCCTextLenient(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 2)
  let roNumber = null, vehicleYear = null, vehicleMake = null, vehicleModel = null, vin = null
  const parts = []
  const seen = new Set()

  for (const line of lines) {
    // Still try to extract metadata
    if (!roNumber) {
      const m = line.match(/RO\s*(?:Number|#|No\.?)[\s:]*(\d+)/i)
      if (m) roNumber = m[1]
    }
    if (!vin) {
      const m = line.match(/VIN[\s:]*([A-HJ-NPR-Z0-9]{17})/i)
      if (m) vin = m[1]
    }
    if (!vehicleYear) {
      const m = line.match(/^(\d{4})\s+([A-Z]{2,5})\s+(\S+)/)
      if (m && MAKE_MAP[m[2]]) {
        vehicleYear = m[1]
        vehicleMake = MAKE_MAP[m[2]]
        vehicleModel = m[3]
      }
    }

    // Skip obvious non-part lines
    if (/^(Page|Date|Total|Subtotal|Tax|Labor|Parts|PARTS|Estimate|CCC|Insurance|Owner|Customer|VIN|RO|Adjuster)/i.test(line)) continue
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(line)) continue
    if (line.length < 4) continue

    // Split on 2+ spaces
    const cols = line.split(/\s{2,}/).map(c => c.trim()).filter(Boolean)
    if (cols.length < 1) continue

    // Extract price from last token
    let price = null
    if (cols.length > 1) {
      const pm = cols[cols.length - 1].match(/^\$?([\d,]+\.\d{2})$/)
      if (pm) { price = parseFloat(pm[1].replace(/,/g, '')); cols.pop() }
    }

    // Extract qty
    let qty = 1
    if (cols.length > 1) {
      const qm = cols[cols.length - 1].match(/^(\d{1,2})$/)
      if (qm) { qty = parseInt(qm[1]) || 1; cols.pop() }
    }

    // Strip leading line number
    if (cols.length > 0 && /^\d{1,3}$/.test(cols[0])) cols.shift()
    if (cols.length === 0) continue

    // Must have at least a description that looks like a real part name (not a number)
    let description = ''
    let partNumber = null
    const last = cols[cols.length - 1]
    const looksLikePart = cols.length > 1 && /^[A-Z0-9][A-Z0-9\-]{3,}$/i.test(last) && /\d/.test(last)
    if (looksLikePart) {
      partNumber = last
      description = cols.slice(0, -1).join(' ').trim()
    } else {
      description = cols.join(' ').trim()
    }

    // Skip pure-number descriptions or single characters
    if (!description || /^\d+$/.test(description) || description.length < 3) continue
    // Skip all-caps short words that are likely headers
    if (/^[A-Z\s]{1,6}$/.test(description)) continue

    const key = description.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    parts.push({ description, partNumber: partNumber || null, qty, price })
  }

  return { roNumber, vin, vehicleYear, vehicleMake, vehicleModel, parts }
}

// POST /api/import/photo
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/tiff', 'image/bmp']
    if (allowed.includes(file.mimetype)) return cb(null, true)
    cb(new Error('Only image files are accepted (jpg, png, webp, tiff, bmp).'))
  },
})

router.post('/photo', requireAuth, photoUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No image uploaded.' })
  }

  let worker
  try {
    const { createWorker } = require('tesseract.js')
    worker = await createWorker('eng')
    const { data: { text } } = await worker.recognize(req.file.buffer)
    await worker.terminate()
    worker = null

    const extracted = (text || '').trim()
    console.log(`[photo-ocr] extracted ${extracted.length} chars`)

    if (extracted.length < 10) {
      return res.status(422).json({
        success: false,
        error: 'Could not read any text from the image. Make sure the estimate is flat, well-lit, and in focus.',
      })
    }

    const result = parseCCCText(extracted)

    // If strict parse found nothing, try the lenient fallback
    if (!result.parts || result.parts.length === 0) {
      const fallback = parseCCCTextLenient(extracted)
      if (fallback.parts && fallback.parts.length > 0) {
        return res.json({ success: true, data: { ...result, ...fallback } })
      }
      return res.status(422).json({
        success: false,
        error: `Image was read (${extracted.length} characters) but no parts table was found. Make sure the Parts List section is visible and in frame. Tip: capture just the parts table, not the full screen.`,
      })
    }

    return res.json({ success: true, data: result })
  } catch (err) {
    if (worker) { try { await worker.terminate() } catch (_) {} }
    console.error('Photo OCR error:', err)
    return res.status(500).json({ success: false, error: 'OCR failed: ' + err.message })
  }
})

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
