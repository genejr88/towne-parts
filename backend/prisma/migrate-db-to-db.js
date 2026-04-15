/**
 * migrate-db-to-db.js
 * Migrates all data from one Railway PostgreSQL to another.
 *
 * Usage (run from backend/ directory):
 *   SOURCE_DATABASE_URL="postgresql://..." DEST_DATABASE_URL="postgresql://..." node prisma/migrate-db-to-db.js
 *
 * SOURCE_DATABASE_URL defaults to the .env DATABASE_URL (faithful-reprieve).
 * DEST_DATABASE_URL must be the new project's DATABASE_URL (shimmering-rebirth).
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const SOURCE_URL = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL
const DEST_URL   = process.env.DEST_DATABASE_URL

if (!SOURCE_URL) { console.error('ERROR: SOURCE_DATABASE_URL (or DATABASE_URL) not set'); process.exit(1) }
if (!DEST_URL)   { console.error('ERROR: DEST_DATABASE_URL not set'); process.exit(1) }

const src  = new PrismaClient({ datasources: { db: { url: SOURCE_URL } } })
const dest = new PrismaClient({ datasources: { db: { url: DEST_URL   } } })

function log(msg) { console.log(msg) }

async function main() {
  log('='.repeat(60))
  log('Towne Parts — DB-to-DB Migration')
  log(`SOURCE: ${SOURCE_URL.slice(0, 50)}...`)
  log(`DEST:   ${DEST_URL.slice(0, 50)}...`)
  log('='.repeat(60))

  // ── 1. Vendors ──────────────────────────────────────────────────────────────
  log('\n── Vendors ─────────────────────────────────────────────────')
  const vendors = await src.vendor.findMany({ orderBy: { id: 'asc' } })
  log(`  ${vendors.length} vendors`)
  const vendorIdMap = {}
  for (const v of vendors) {
    const existing = await dest.vendor.findUnique({ where: { name: v.name } })
    if (existing) {
      vendorIdMap[v.id] = existing.id
      log(`  ~ ${v.name} (already exists → id ${existing.id})`)
      continue
    }
    const created = await dest.vendor.create({ data: { name: v.name, isActive: v.isActive, createdAt: v.createdAt } })
    vendorIdMap[v.id] = created.id
    log(`  + ${v.name} → id ${created.id}`)
  }

  // ── 2. ROs ──────────────────────────────────────────────────────────────────
  log('\n── Repair Orders ───────────────────────────────────────────')
  const ros = await src.rO.findMany({ orderBy: { id: 'asc' } })
  log(`  ${ros.length} ROs`)
  const roIdMap = {}
  let roCreated = 0, roSkipped = 0

  for (const ro of ros) {
    const existing = await dest.rO.findUnique({ where: { roNumber: ro.roNumber } })
    if (existing) {
      roIdMap[ro.id] = existing.id
      roSkipped++
      continue
    }
    const created = await dest.rO.create({
      data: {
        roNumber:                ro.roNumber,
        vehicleYear:             ro.vehicleYear,
        vehicleMake:             ro.vehicleMake,
        vehicleModel:            ro.vehicleModel,
        vehicleColor:            ro.vehicleColor,
        vin:                     ro.vin,
        vendorId:                ro.vendorId ? (vendorIdMap[ro.vendorId] || null) : null,
        partsStatus:             ro.partsStatus,
        productionStage:         ro.productionStage,
        productionStatusNote:    ro.productionStatusNote,
        productionWaitingParts:  ro.productionWaitingParts,
        productionNextStep:      ro.productionNextStep,
        productionFinalSupplement: ro.productionFinalSupplement,
        productionSupplementNote: ro.productionSupplementNote,
        productionUpdatedAt:     ro.productionUpdatedAt,
        isArchived:              ro.isArchived,
        archivedAt:              ro.archivedAt,
        createdAt:               ro.createdAt,
        updatedAt:               ro.updatedAt,
      },
    })
    roIdMap[ro.id] = created.id
    log(`  + RO ${ro.roNumber}${ro.isArchived ? ' [archived]' : ''} → id ${created.id}`)
    roCreated++
  }
  log(`  ROs: ${roCreated} created, ${roSkipped} skipped (already exist)`)

  // ── 3. Parts ─────────────────────────────────────────────────────────────────
  log('\n── Parts ───────────────────────────────────────────────────')
  const parts = await src.part.findMany({ orderBy: { id: 'asc' } })
  log(`  ${parts.length} parts`)
  const partIdMap = {}
  let partsCreated = 0, partsSkipped = 0

  for (const p of parts) {
    const destROId = roIdMap[p.roId]
    if (!destROId) { log(`  ! Part id=${p.id} — skipping, RO not found`); continue }

    // Check if this part already migrated (same ro + partNumber + description)
    const existing = await dest.part.findFirst({
      where: { roId: destROId, partNumber: p.partNumber, description: p.description }
    })
    if (existing) {
      partIdMap[p.id] = existing.id
      partsSkipped++
      continue
    }

    const created = await dest.part.create({
      data: {
        roId:        destROId,
        qty:         p.qty,
        partNumber:  p.partNumber,
        description: p.description,
        dateOrdered: p.dateOrdered,
        etaDate:     p.etaDate,
        finishStatus: p.finishStatus,
        isReceived:  p.isReceived,
        hasCore:     p.hasCore,
        receivedAt:  p.receivedAt,
        price:       p.price,
        createdAt:   p.createdAt,
        updatedAt:   p.updatedAt,
      },
    })
    partIdMap[p.id] = created.id
    partsCreated++
  }
  log(`  Parts: ${partsCreated} created, ${partsSkipped} skipped`)

  // ── 4. Invoices ──────────────────────────────────────────────────────────────
  log('\n── Invoices ────────────────────────────────────────────────')
  const invoices = await src.rOInvoice.findMany({ orderBy: { id: 'asc' } })
  log(`  ${invoices.length} invoices (DB records only — files are ephemeral on Railway)`)
  let invCreated = 0
  for (const inv of invoices) {
    const destROId = roIdMap[inv.roId]
    if (!destROId) continue
    const existing = await dest.rOInvoice.findFirst({ where: { roId: destROId, originalFilename: inv.originalFilename } })
    if (existing) continue
    await dest.rOInvoice.create({
      data: {
        roId: destROId,
        originalFilename: inv.originalFilename,
        storedPath: inv.storedPath,
        uploadedBy: inv.uploadedBy,
        createdAt: inv.createdAt,
      },
    })
    invCreated++
  }
  log(`  Invoices: ${invCreated} created`)

  // ── 5. SRC Entries ───────────────────────────────────────────────────────────
  log('\n── SRC Entries ─────────────────────────────────────────────')
  const srcEntries = await src.sRCEntry.findMany({ orderBy: { id: 'asc' } })
  log(`  ${srcEntries.length} SRC entries`)
  let srcCreated = 0
  for (const e of srcEntries) {
    const destROId = roIdMap[e.roId]
    if (!destROId) continue
    await dest.sRCEntry.create({
      data: {
        roId: destROId,
        entryType: e.entryType,
        status: e.status,
        note: e.note,
        createdBy: e.createdBy,
        completedAt: e.completedAt,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      },
    })
    srcCreated++
  }
  log(`  SRC: ${srcCreated} created`)

  // ── 6. Activity Log ──────────────────────────────────────────────────────────
  log('\n── Activity Log ────────────────────────────────────────────')
  const activity = await src.activityLog.findMany({ orderBy: { id: 'asc' } })
  log(`  ${activity.length} log entries`)
  let actCreated = 0
  for (const a of activity) {
    const destROId = roIdMap[a.roId]
    if (!destROId) continue
    await dest.activityLog.create({
      data: {
        roId: destROId,
        eventType: a.eventType,
        message: a.message,
        createdAt: a.createdAt,
      },
    })
    actCreated++
  }
  log(`  Activity: ${actCreated} created`)

  // ── 7. Users ─────────────────────────────────────────────────────────────────
  // Users are seeded fresh on the new project (gene/Admin/alissa passwords reset).
  log('\n── Users ───────────────────────────────────────────────────')
  log('  Skipping — seed.js handles users with reset passwords on new project.')

  // ── 8. Reset sequences ───────────────────────────────────────────────────────
  log('\n── Resetting sequences ─────────────────────────────────────')
  const seqNames = ['users_id_seq','vendors_id_seq','ros_id_seq','parts_id_seq',
                    'part_photos_id_seq','ro_invoices_id_seq','src_entries_id_seq','activity_log_id_seq']
  for (const seq of seqNames) {
    try {
      await dest.$executeRawUnsafe(`ALTER SEQUENCE "${seq}" RESTART WITH 10000`)
      log(`  [seq] ${seq} → restarted at 10000`)
    } catch (e) {
      log(`  [seq] ${seq} — ${e.message}`)
    }
  }

  log('\n' + '='.repeat(60))
  log('✅ Migration complete!')
  log('Note: Photo FILES are stored on Railway\'s ephemeral filesystem and cannot')
  log('be migrated automatically. Photo DB records were migrated but files will')
  log('need to be re-uploaded if still needed.')
  log('='.repeat(60))
}

main()
  .catch(err => { console.error('Migration failed:', err); process.exit(1) })
  .finally(() => Promise.all([src.$disconnect(), dest.$disconnect()]))
