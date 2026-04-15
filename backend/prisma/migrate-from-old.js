/**
 * migrate-from-old.js — Direct Prisma migration from old SQLite to new PostgreSQL
 *
 * Run from the backend/ directory with your Railway DATABASE_URL set:
 *
 *   cd backend
 *   DATABASE_URL="postgresql://..." node prisma/migrate-from-old.js
 *
 * Or set it in backend/.env (already used by the app) and just run:
 *   cd backend
 *   node prisma/migrate-from-old.js
 *
 * Photos are copied from the old machine into backend/uploads/parts/
 * then a DB record is created pointing to the local filename.
 *
 * NOTE: Railway filesystem is ephemeral — photos will be lost on redeploy.
 * Consider migrating to Cloudinary or S3 for permanent photo storage.
 */

require('dotenv').config()
const path = require('path')
const fs = require('fs')

// ── Paths ─────────────────────────────────────────────────────────────────────
const OLD_DB_PATH = 'C:/Users/towne/AppData/Local/TownePartsManager/towne_parts_manager.db'
const OLD_PHOTOS_ROOT = 'C:/Users/towne/AppData/Local/TownePartsManager'
const NEW_PHOTOS_DIR = path.join(__dirname, '../uploads/parts')

// ── Make sure we can require better-sqlite3 ───────────────────────────────────
let Database
try {
  Database = require('better-sqlite3')
} catch {
  console.error('ERROR: better-sqlite3 is not installed.')
  console.error('Run: npm install better-sqlite3  (in the towne-parts root or backend dir)')
  process.exit(1)
}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// ── Value mappings ─────────────────────────────────────────────────────────────
function mapPartsStatus(oldStatus) {
  if (oldStatus === 'parts_here') return 'ALL_HERE'
  return 'MISSING'
}

function mapFinishStatus(oldStatus) {
  const map = {
    'needs_paint': 'NEEDS_PAINT',
    'painted': 'PAINTED',
    'textured': 'TEXTURED',
    'no_finish_needed': 'NO_FINISH_NEEDED',
    '': 'NO_FINISH_NEEDED',
  }
  return map[oldStatus] || 'NO_FINISH_NEEDED'
}

function mapProductionStage(oldStage) {
  if (!oldStage || oldStage === '') return 'unassigned'
  return oldStage
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60))
  console.log('Towne Parts — Direct Prisma Migration')
  console.log('='.repeat(60))
  console.log(`Source DB: ${OLD_DB_PATH}`)
  console.log(`Photos destination: ${NEW_PHOTOS_DIR}`)
  console.log(`Database URL: ${process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 40) + '...' : '(not set)'}`)

  if (!process.env.DATABASE_URL) {
    console.error('\nERROR: DATABASE_URL is not set.')
    console.error('Set it in backend/.env or pass it as an env variable.')
    process.exit(1)
  }

  if (!fs.existsSync(OLD_DB_PATH)) {
    console.error(`\nERROR: Old database not found at ${OLD_DB_PATH}`)
    process.exit(1)
  }

  // Ensure photos directory exists
  fs.mkdirSync(NEW_PHOTOS_DIR, { recursive: true })

  const oldDb = new Database(OLD_DB_PATH, { readonly: true })
  console.log('\n✓ Old database opened')

  // ── Step 1: Vendors ─────────────────────────────────────────────────────────
  console.log('\n── Step 1: Vendors ────────────────────────────────────')
  const oldVendors = oldDb.prepare('SELECT * FROM vendors WHERE is_active = 1 ORDER BY id').all()

  const vendorNameToId = {}

  // Load existing vendors
  const existingVendors = await prisma.vendor.findMany()
  existingVendors.forEach(v => { vendorNameToId[v.name.toLowerCase()] = v.id })

  for (const ov of oldVendors) {
    const key = ov.name.toLowerCase()
    if (vendorNameToId[key]) {
      console.log(`  ~ ${ov.name} — already exists (id ${vendorNameToId[key]})`)
      continue
    }
    const v = await prisma.vendor.upsert({
      where: { name: ov.name },
      update: {},
      create: { name: ov.name },
    })
    vendorNameToId[key] = v.id
    console.log(`  + ${ov.name} — created (id ${v.id})`)
  }

  function resolveVendorId(vendorName) {
    if (!vendorName) return null
    return vendorNameToId[vendorName.toLowerCase()] || null
  }

  // ── Step 2: ROs ─────────────────────────────────────────────────────────────
  console.log('\n── Step 2: Repair Orders ──────────────────────────────')
  const oldROs = oldDb.prepare('SELECT * FROM ros ORDER BY id').all()
  console.log(`Found ${oldROs.length} ROs`)

  const oldROIdToNewROId = {}
  let roCreated = 0, roSkipped = 0

  for (const ro of oldROs) {
    // Check if already exists
    const existing = await prisma.rO.findUnique({ where: { roNumber: ro.ro_number } })
    if (existing) {
      oldROIdToNewROId[ro.id] = existing.id
      console.log(`  ~ RO ${ro.ro_number} — already exists`)
      roSkipped++
      continue
    }

    const vendorId = resolveVendorId(ro.vendor_name)

    const newRO = await prisma.rO.create({
      data: {
        roNumber: ro.ro_number,
        vehicleYear: ro.vehicle_year || null,
        vehicleMake: ro.vehicle_make || null,
        vehicleModel: ro.vehicle_model || null,
        vehicleColor: null,
        vin: ro.vin || null,
        vendorId: vendorId || null,
        partsStatus: mapPartsStatus(ro.parts_status),
        productionStage: mapProductionStage(ro.production_stage),
        productionStatusNote: ro.production_status_note || null,
        productionWaitingParts: ro.production_waiting_parts || null,
        productionNextStep: ro.production_next_step || null,
        productionFinalSupplement: Boolean(ro.production_final_supplement),
        productionSupplementNote: ro.production_supplement_note || null,
        isArchived: Boolean(ro.is_archived),
        archivedAt: ro.archived_at ? new Date(ro.archived_at) : null,
        createdAt: ro.created_at ? new Date(ro.created_at) : undefined,
      },
    })

    oldROIdToNewROId[ro.id] = newRO.id
    console.log(`  + RO ${ro.ro_number} → id ${newRO.id}${ro.is_archived ? ' [archived]' : ''}`)
    roCreated++
  }

  console.log(`\n  ROs: ${roCreated} created, ${roSkipped} already existed`)

  // ── Step 3: Parts ────────────────────────────────────────────────────────────
  console.log('\n── Step 3: Parts ───────────────────────────────────────')
  const oldParts = oldDb.prepare('SELECT * FROM parts ORDER BY id').all()
  console.log(`Found ${oldParts.length} parts`)

  const oldPartIdToNewPartId = {}
  let partsCreated = 0, partsSkipped = 0

  for (const part of oldParts) {
    const newROId = oldROIdToNewROId[part.ro_id]
    if (!newROId) {
      console.warn(`  ! Part ${part.id} — RO ${part.ro_id} not migrated, skipping`)
      partsSkipped++
      continue
    }

    const isReceived = Boolean(part.is_received)

    const newPart = await prisma.part.create({
      data: {
        roId: newROId,
        qty: part.qty ? Math.round(part.qty) : 1,
        partNumber: part.part_number || null,
        description: part.description || null,
        dateOrdered: part.date_ordered ? new Date(part.date_ordered) : null,
        etaDate: part.eta_date ? new Date(part.eta_date) : null,
        finishStatus: mapFinishStatus(part.finish_status),
        isReceived,
        hasCore: Boolean(part.has_core),
        receivedAt: part.received_at ? new Date(part.received_at) : (isReceived ? new Date() : null),
        price: part.price != null ? part.price : null,
        createdAt: part.created_at ? new Date(part.created_at) : undefined,
      },
    })

    oldPartIdToNewPartId[part.id] = newPart.id
    console.log(`  + Part ${part.id} "${part.description || part.part_number || '—'}" → id ${newPart.id}`)
    partsCreated++
  }

  console.log(`\n  Parts: ${partsCreated} created, ${partsSkipped} skipped`)

  // ── Step 4: Photos ───────────────────────────────────────────────────────────
  console.log('\n── Step 4: Photos ──────────────────────────────────────')
  const oldPhotos = oldDb.prepare('SELECT * FROM part_photos ORDER BY id').all()
  console.log(`Found ${oldPhotos.length} photos`)

  let photosOk = 0, photosMissing = 0, photosSkipped = 0

  for (const photo of oldPhotos) {
    const newPartId = oldPartIdToNewPartId[photo.part_id]
    if (!newPartId) {
      console.warn(`  ! Photo ${photo.id} — part ${photo.part_id} not migrated, skipping`)
      photosSkipped++
      continue
    }

    // Resolve old file path
    const normalizedRelPath = photo.stored_relative_path.replace(/\\/g, '/')
    const srcPath = path.join(OLD_PHOTOS_ROOT, normalizedRelPath)

    if (!fs.existsSync(srcPath)) {
      console.warn(`  ! Photo ${photo.id} — file not found: ${srcPath}`)
      photosMissing++
      continue
    }

    // Copy file to new uploads/parts/ with a unique name
    const ext = path.extname(photo.original_filename || srcPath)
    const newFilename = `part-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`
    const destPath = path.join(NEW_PHOTOS_DIR, newFilename)

    fs.copyFileSync(srcPath, destPath)

    await prisma.partPhoto.create({
      data: {
        partId: newPartId,
        originalFilename: photo.original_filename || null,
        storedPath: newFilename,
        createdAt: photo.created_at ? new Date(photo.created_at) : undefined,
      },
    })

    console.log(`  + Photo ${photo.id} "${photo.original_filename}" → ${newFilename}`)
    photosOk++
  }

  console.log(`\n  Photos: ${photosOk} copied, ${photosMissing} not found, ${photosSkipped} skipped`)

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log('Migration Complete!')
  console.log('='.repeat(60))
  console.log(`  ROs:    ${roCreated} created, ${roSkipped} already existed`)
  console.log(`  Parts:  ${partsCreated} created, ${partsSkipped} skipped`)
  console.log(`  Photos: ${photosOk} copied, ${photosMissing} not found, ${photosSkipped} skipped`)
  console.log('')
  console.log('⚠️  Photos are now in backend/uploads/parts/ locally.')
  console.log('   If deploying to Railway, you\'ll need to run this script')
  console.log('   AFTER the backend is running, or set up cloud storage.')

  oldDb.close()
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('\nFATAL ERROR:', err.message)
  console.error(err.stack)
  await prisma.$disconnect()
  process.exit(1)
})
