/**
 * fix-missing-photos.js
 *
 * Reconciles photos from the old SQLite system to the new PostgreSQL DB.
 *
 * The Postgres→Postgres migration created PartPhoto records but with
 * storedPath = '' because it couldn't copy the actual files.
 * This script:
 *   1. Reads old SQLite for all part_photos
 *   2. Finds the file on disk (old TownePartsManager path)
 *   3. Copies it to backend/uploads/parts/ with a new unique filename
 *   4. Finds the matching DB record (by originalFilename + empty storedPath)
 *   5. Updates storedPath so the record now points to the file
 *   6. Deletes any remaining empty-storedPath records that couldn't be matched
 *      (photos uploaded to Railway's ephemeral FS — gone forever)
 *
 * Run from backend/ directory:
 *   node prisma/fix-missing-photos.js
 */

require('dotenv').config()
const path  = require('path')
const fs    = require('fs')

let Database
try {
  Database = require('better-sqlite3')
} catch {
  console.error('ERROR: better-sqlite3 not installed.')
  console.error('Run: npm install better-sqlite3  inside the towne-parts root or backend dir')
  process.exit(1)
}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const OLD_DB_PATH   = 'C:/Users/towne/AppData/Local/TownePartsManager/towne_parts_manager.db'
const OLD_ROOT      = 'C:/Users/towne/AppData/Local/TownePartsManager'
const NEW_PARTS_DIR = path.join(__dirname, '../uploads/parts')

async function main() {
  console.log('='.repeat(60))
  console.log('Towne Parts — Fix Missing Part Photos')
  console.log('='.repeat(60))

  if (!fs.existsSync(OLD_DB_PATH)) {
    console.error(`ERROR: Old SQLite DB not found at ${OLD_DB_PATH}`)
    process.exit(1)
  }

  fs.mkdirSync(NEW_PARTS_DIR, { recursive: true })

  const db = new Database(OLD_DB_PATH, { readonly: true })
  const oldPhotos = db.prepare('SELECT * FROM part_photos ORDER BY id ASC').all()
  console.log(`\nOld SQLite: ${oldPhotos.length} photo records`)

  // ── Pass 1: Fix photos that exist in old SQLite ───────────────────────────
  console.log('\n── Pass 1: Restoring old SQLite photos ─────────────────')
  let fixed = 0, fileMissing = 0, noMatch = 0

  for (const op of oldPhotos) {
    const relPath = op.stored_relative_path.replace(/\\/g, '/')
    const srcPath = path.join(OLD_ROOT, relPath)

    if (!fs.existsSync(srcPath)) {
      console.warn(`  ! File missing on disk: ${srcPath}`)
      fileMissing++
      continue
    }

    // Find the matching empty DB record by originalFilename
    // If multiple empty records share the same filename (shouldn't happen for hashed names),
    // take the one with the lowest id to process in order.
    const emptyRecord = await prisma.partPhoto.findFirst({
      where: { originalFilename: op.original_filename, storedPath: '' },
      orderBy: { id: 'asc' },
    })

    if (!emptyRecord) {
      // No empty record matches — check if a record already exists with a proper storedPath
      const existing = await prisma.partPhoto.findFirst({
        where: { originalFilename: op.original_filename, NOT: { storedPath: '' } },
      })
      if (existing) {
        console.log(`  ~ ${op.original_filename} already fixed (storedPath=${existing.storedPath})`)
      } else {
        console.log(`  ? No DB record found for ${op.original_filename} — skipping`)
        noMatch++
      }
      continue
    }

    // Copy file to new uploads/parts/ with a unique name
    const ext = path.extname(op.original_filename || srcPath) || '.jpg'
    const newFilename = `part-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`
    const destPath = path.join(NEW_PARTS_DIR, newFilename)

    fs.copyFileSync(srcPath, destPath)

    await prisma.partPhoto.update({
      where: { id: emptyRecord.id },
      data: { storedPath: newFilename },
    })

    console.log(`  ✓ Photo ${emptyRecord.id} (part ${emptyRecord.partId}): ${op.original_filename} → ${newFilename}`)
    fixed++
  }

  console.log(`\n  Restored: ${fixed} | File missing: ${fileMissing} | No DB match: ${noMatch}`)

  // ── Pass 2: Clean up remaining empty-storedPath records ──────────────────
  // Any empty records left at this point have no corresponding old file
  // (they were uploaded to Railway's ephemeral FS and wiped on redeploy).
  const remaining = await prisma.partPhoto.findMany({
    where: { storedPath: '' },
    include: { part: { include: { ro: { select: { roNumber: true } } } } },
    orderBy: { id: 'asc' },
  })

  console.log(`\n── Pass 2: Cleaning up ${remaining.length} unrecoverable photo records ─`)
  if (remaining.length === 0) {
    console.log('  Nothing to clean up!')
  } else {
    // Group by RO for readable output
    const byRO = {}
    for (const r of remaining) {
      const roNum = r.part?.ro?.roNumber || '?'
      if (!byRO[roNum]) byRO[roNum] = []
      byRO[roNum].push(r.id)
    }
    for (const [roNum, ids] of Object.entries(byRO)) {
      console.log(`  RO ${roNum}: ${ids.length} broken photo record(s) → IDs ${ids.join(', ')}`)
    }

    const ids = remaining.map(r => r.id)
    await prisma.partPhoto.deleteMany({ where: { id: { in: ids } } })
    console.log(`\n  Deleted ${ids.length} unrecoverable photo records.`)
    console.log('  (These were uploaded to Railway and lost on redeploy — re-upload them.)')
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log('Done!')
  console.log('='.repeat(60))
  console.log(`  Photos restored from old SQLite: ${fixed}`)
  console.log(`  Old files not found on disk:     ${fileMissing}`)
  console.log(`  Unrecoverable (Railway wipe):    ${remaining.length}`)
  if (remaining.length > 0) {
    console.log('\n  ⚠  The unrecoverable photos were deleted from the DB.')
    console.log('     Open each affected RO and re-upload those photos.')
  }
  console.log('\n  ℹ  Photos are now in backend/uploads/parts/ (local only).')
  console.log('     If using Railway, migrate to Cloudinary for permanent storage.')

  db.close()
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('\nFATAL:', err.message)
  console.error(err.stack)
  await prisma.$disconnect()
  process.exit(1)
})
