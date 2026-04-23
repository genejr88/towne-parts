/**
 * pull-photos-from-old-app.js
 *
 * Pulls photo binary data (BYTEA) from the old parts-track Railway PostgreSQL,
 * writes each photo to backend/uploads/parts/ as a .jpg file,
 * and creates/updates the PartPhoto DB record in the new app.
 *
 * Old app: parts.towneapps.com  (hopper.proxy.rlwy.net:24948)
 * New app: towne-parts on Railway  (maglev.proxy.rlwy.net:11968)
 *
 * Run from backend/ directory:
 *   node prisma/pull-photos-from-old-app.js
 *
 * Or for a single RO only:
 *   RO_NUMBER=5557 node prisma/pull-photos-from-old-app.js
 */

require('dotenv').config()
const path = require('path')
const fs   = require('fs')
const { PrismaClient } = require('@prisma/client')

// ── Config ────────────────────────────────────────────────────────────────────
const OLD_PG_URL    = 'postgresql://postgres:xBDsdChngoMGeFlzpzAyrlzhzesMwZUS@hopper.proxy.rlwy.net:24948/railway'
const NEW_PARTS_DIR = path.join(__dirname, '../uploads/parts')
const RO_FILTER     = process.env.RO_NUMBER || null   // e.g. RO_NUMBER=5557

// ── DB clients ────────────────────────────────────────────────────────────────
// Old DB via pg (raw SQL — old schema doesn't match Prisma models)
let pg
try {
  pg = require('pg')
} catch {
  console.error('ERROR: pg not installed. Run: npm install pg  inside the towne-parts root or backend dir')
  process.exit(1)
}

const oldClient = new pg.Client({
  connectionString: OLD_PG_URL,
  ssl: { rejectUnauthorized: false },
})

const prisma = new PrismaClient()

// ── Helpers ───────────────────────────────────────────────────────────────────
function uniqueFilename(ext = '.jpg') {
  return `part-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`
}

function extFromFilename(name) {
  if (!name) return '.jpg'
  const e = path.extname(name).toLowerCase()
  return e || '.jpg'
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60))
  console.log('Towne Parts — Pull Photos from Old Railway App')
  console.log('='.repeat(60))
  console.log(`Old DB: hopper.proxy.rlwy.net:24948`)
  console.log(`New DB: ${process.env.DATABASE_URL?.slice(0, 45)}...`)
  if (RO_FILTER) console.log(`Filtering to RO: ${RO_FILTER}`)
  console.log()

  fs.mkdirSync(NEW_PARTS_DIR, { recursive: true })

  await oldClient.connect()
  console.log('✓ Connected to old Railway PostgreSQL')

  // ── 1. Get photo records from old DB ───────────────────────────────────────
  // The old schema: part_photos(id, part_id, original_filename, stored_relative_path, content_type, photo_data)
  // Parts are in: ro_parts(id, ro_id, ...) or parts(id, ro_id, ...)
  // ROs are in: ros(id, ro_number, ...)
  //
  // We need to join: ros → parts → part_photos

  // First, figure out the parts table name (old app uses 'parts' or 'ro_parts')
  const tablesRes = await oldClient.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `)
  const tables = tablesRes.rows.map(r => r.table_name)
  console.log('Old DB tables:', tables.join(', '))

  const partsTable = tables.includes('parts') ? 'parts' : tables.includes('ro_parts') ? 'ro_parts' : null
  if (!partsTable) {
    console.error('ERROR: Could not find parts table in old DB')
    process.exit(1)
  }
  console.log(`Using parts table: ${partsTable}`)

  // Check if photo_data column exists on part_photos
  const colRes = await oldClient.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'part_photos' AND table_schema = 'public'
    ORDER BY ordinal_position
  `)
  const photoColumns = colRes.rows.map(r => r.column_name)
  console.log(`part_photos columns: ${photoColumns.join(', ')}`)
  const hasPhotoData = photoColumns.includes('photo_data')

  // Build query
  let query, params = []
  if (RO_FILTER) {
    query = `
      SELECT pp.id, pp.part_id, pp.original_filename, pp.stored_relative_path,
             pp.content_type, ${hasPhotoData ? 'pp.photo_data' : 'NULL as photo_data'}
      FROM part_photos pp
      JOIN ${partsTable} p ON p.id = pp.part_id
      JOIN ros r ON r.id = p.ro_id
      WHERE r.ro_number = $1
      ORDER BY pp.id ASC
    `
    params = [RO_FILTER]
  } else {
    query = `
      SELECT pp.id, pp.part_id, pp.original_filename, pp.stored_relative_path,
             pp.content_type, ${hasPhotoData ? 'pp.photo_data' : 'NULL as photo_data'}
      FROM part_photos pp
      ORDER BY pp.id ASC
    `
  }

  const photosRes = await oldClient.query(query, params)
  const oldPhotos = photosRes.rows
  console.log(`\nFound ${oldPhotos.length} photos in old DB${RO_FILTER ? ` for RO ${RO_FILTER}` : ''}`)

  if (oldPhotos.length === 0) {
    console.log('Nothing to do.')
    await cleanup()
    return
  }

  // ── 2. Build a map of old_part_id → new_part_id via RO number + part index ─
  // We need to know which new DB part corresponds to each old DB part.
  // Strategy: match by ro_number, then by the old part's sequence within the RO.
  // This is a best-effort match — order-dependent but usually accurate.
  console.log('\n── Resolving old part IDs → new part IDs ───────────────')

  const oldPartIds = [...new Set(oldPhotos.map(p => p.part_id))]

  // Fetch old parts with their RO numbers
  const oldPartsRes = await oldClient.query(`
    SELECT p.id as part_id, r.ro_number, p.description, p.part_number
    FROM ${partsTable} p
    JOIN ros r ON r.id = p.ro_id
    WHERE p.id = ANY($1::int[])
    ORDER BY r.ro_number, p.id
  `, [oldPartIds])

  const oldPartsMeta = {}
  oldPartsRes.rows.forEach(r => {
    oldPartsMeta[r.part_id] = { roNumber: String(r.ro_number), description: r.description, partNumber: r.part_number }
  })

  // Build old_part_id → new_part_id map
  const partIdMap = {}
  const unresolvedParts = new Set()

  for (const [oldPartId, meta] of Object.entries(oldPartsMeta)) {
    // Find new RO
    const newRO = await prisma.rO.findUnique({ where: { roNumber: meta.roNumber } })
    if (!newRO) { unresolvedParts.add(oldPartId); continue }

    // Find matching part in new DB — match by description or partNumber
    const candidates = await prisma.part.findMany({
      where: {
        roId: newRO.id,
        OR: [
          meta.description ? { description: meta.description } : undefined,
          meta.partNumber  ? { partNumber: meta.partNumber }   : undefined,
        ].filter(Boolean),
      },
    })

    if (candidates.length === 1) {
      partIdMap[oldPartId] = candidates[0].id
    } else if (candidates.length > 1) {
      // Multiple matches — take first (same description, could be duplicates)
      partIdMap[oldPartId] = candidates[0].id
      console.log(`  ? Part ${oldPartId} (RO ${meta.roNumber} "${meta.description}"): ${candidates.length} candidates, using first`)
    } else {
      unresolvedParts.add(oldPartId)
      console.log(`  ! Part ${oldPartId} (RO ${meta.roNumber} "${meta.description}"): no matching part in new DB`)
    }
  }

  console.log(`  Resolved: ${Object.keys(partIdMap).length} / ${oldPartIds.length} parts`)
  if (unresolvedParts.size > 0) {
    console.log(`  Unresolved part IDs: ${[...unresolvedParts].join(', ')}`)
  }

  // ── 3. Process each photo ─────────────────────────────────────────────────
  console.log('\n── Processing photos ────────────────────────────────────')
  let created = 0, updated = 0, skipped = 0, noData = 0, noPart = 0

  for (const photo of oldPhotos) {
    const newPartId = partIdMap[photo.part_id]
    if (!newPartId) { noPart++; continue }

    // Get photo bytes — from BYTEA column or skip
    let imgBuffer = null
    if (photo.photo_data) {
      imgBuffer = Buffer.isBuffer(photo.photo_data) ? photo.photo_data : Buffer.from(photo.photo_data)
    }

    if (!imgBuffer || imgBuffer.length === 0) {
      console.log(`  ! Photo ${photo.id} (part ${photo.part_id}): no binary data`)
      noData++
      continue
    }

    // Write file to new uploads/parts/
    const ext = extFromFilename(photo.original_filename)
    const newFilename = uniqueFilename(ext)
    const destPath = path.join(NEW_PARTS_DIR, newFilename)
    fs.writeFileSync(destPath, imgBuffer)

    // Check if this photo already exists in new DB (match by originalFilename + partId + empty storedPath)
    const existing = await prisma.partPhoto.findFirst({
      where: {
        partId: newPartId,
        originalFilename: photo.original_filename || null,
        storedPath: '',
      },
    })

    if (existing) {
      await prisma.partPhoto.update({
        where: { id: existing.id },
        data: { storedPath: newFilename },
      })
      console.log(`  ✓ Updated photo ${existing.id} (part ${newPartId}): ${photo.original_filename} → ${newFilename} [${(imgBuffer.length / 1024).toFixed(0)} KB]`)
      updated++
    } else {
      // Check if we'd be duplicating a photo that already has a storedPath
      const duplicate = await prisma.partPhoto.findFirst({
        where: {
          partId: newPartId,
          originalFilename: photo.original_filename || null,
          NOT: { storedPath: '' },
        },
      })

      if (duplicate) {
        console.log(`  ~ Photo for part ${newPartId} "${photo.original_filename}" already has file → skipping`)
        fs.unlinkSync(destPath)  // remove the file we just wrote
        skipped++
        continue
      }

      await prisma.partPhoto.create({
        data: {
          partId: newPartId,
          originalFilename: photo.original_filename || null,
          storedPath: newFilename,
        },
      })
      console.log(`  + Created photo for part ${newPartId}: ${photo.original_filename} → ${newFilename} [${(imgBuffer.length / 1024).toFixed(0)} KB]`)
      created++
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log('Done!')
  console.log('='.repeat(60))
  console.log(`  Photos created:         ${created}`)
  console.log(`  Photos updated:         ${updated}`)
  console.log(`  Already had file:       ${skipped}`)
  console.log(`  No binary data in old:  ${noData}`)
  console.log(`  Part not in new DB:     ${noPart}`)
  console.log()
  console.log('  ℹ  Files written to backend/uploads/parts/ (local only).')
  console.log('     For Railway access, migrate to Cloudinary for permanent storage.')

  await cleanup()
}

async function cleanup() {
  await oldClient.end()
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('\nFATAL:', err.message)
  console.error(err.stack)
  await cleanup()
  process.exit(1)
})
