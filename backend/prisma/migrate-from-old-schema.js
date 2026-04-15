/**
 * migrate-from-old-schema.js
 *
 * Migrates data from the OLD parts-track database (faithful-reprieve)
 * to the NEW towne-parts database (shimmering-rebirth).
 *
 * The old schema uses snake_case, vendor_name strings, integer booleans (0/1),
 * and different parts_status enum values.
 *
 * Usage:
 *   SOURCE_DATABASE_URL="postgresql://..." \
 *   DEST_DATABASE_URL="postgresql://..."   \
 *   node prisma/migrate-from-old-schema.js
 *
 * DEST_DATABASE_URL defaults to .env DATABASE_URL.
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const SOURCE_URL = process.env.SOURCE_DATABASE_URL
const DEST_URL   = process.env.DEST_DATABASE_URL || process.env.DATABASE_URL

if (!SOURCE_URL) { console.error('ERROR: SOURCE_DATABASE_URL not set'); process.exit(1) }
if (!DEST_URL)   { console.error('ERROR: DEST_DATABASE_URL (or DATABASE_URL) not set'); process.exit(1) }

// Source DB — use raw SQL only (old schema doesn't match Prisma models)
const src  = new PrismaClient({ datasources: { db: { url: SOURCE_URL } } })
// Dest DB — use Prisma API (new schema)
const dest = new PrismaClient({ datasources: { db: { url: DEST_URL   } } })

function log(msg) { console.log(msg) }

// Map old finish_status values → new FinishStatus enum
function mapFinishStatus(old) {
  if (!old) return 'NO_FINISH_NEEDED'
  const v = String(old).toLowerCase()
  if (v === 'needs_paint' || v === 'needspaint') return 'NEEDS_PAINT'
  if (v === 'painted') return 'PAINTED'
  if (v === 'textured') return 'TEXTURED'
  return 'NO_FINISH_NEEDED'
}

// Map old parts_status values → new enum
function mapPartsStatus(old) {
  if (!old) return 'MISSING'
  const v = String(old).toLowerCase()
  if (v === 'parts_here' || v === 'all_here') return 'ALL_HERE'
  if (v === 'acknowledged') return 'ACKNOWLEDGED'
  return 'MISSING'
}

// Safe date conversion
function toDate(v) {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

// Integer → boolean (old DB uses 0/1)
function toBool(v) { return v === 1 || v === true || v === '1' || v === 'true' }

async function main() {
  log('='.repeat(60))
  log('Towne Parts — Cross-Schema Migration')
  log(`SOURCE: ${SOURCE_URL.slice(0, 55)}...`)
  log(`DEST:   ${DEST_URL.slice(0, 55)}...`)
  log('='.repeat(60))

  // ── 1. Vendors ──────────────────────────────────────────────
  log('\n── Vendors ─────────────────────────────────────────────────')
  let oldVendors = []
  try {
    oldVendors = await src.$queryRawUnsafe('SELECT * FROM vendors ORDER BY id ASC')
  } catch (e) {
    log(`  [WARN] vendors table not found or empty: ${e.message}`)
  }
  log(`  ${oldVendors.length} vendors in source`)

  const vendorNameMap = {} // old name → new id
  for (const v of oldVendors) {
    const name = v.name || v.vendor_name
    if (!name) continue
    const ex = await dest.vendor.findUnique({ where: { name } })
    if (ex) { vendorNameMap[name] = ex.id; continue }
    const n = await dest.vendor.create({ data: { name, isActive: true } })
    vendorNameMap[name] = n.id
    log(`  + ${name} → id ${n.id}`)
  }

  // ── 2. ROs ──────────────────────────────────────────────────
  log('\n── Repair Orders ───────────────────────────────────────────')
  const oldROs = await src.$queryRawUnsafe('SELECT * FROM ros ORDER BY id ASC')
  log(`  ${oldROs.length} ROs in source`)

  const roIdMap = {} // old id → new id
  let roCreated = 0, roSkipped = 0

  for (const ro of oldROs) {
    const roNumber = String(ro.ro_number || ro.roNumber || ro.id)

    // Skip duplicates
    const ex = await dest.rO.findUnique({ where: { roNumber } })
    if (ex) { roIdMap[ro.id] = ex.id; roSkipped++; continue }

    // Resolve vendor
    const vName = ro.vendor_name || ro.vendorName
    const vendorId = vName ? (vendorNameMap[vName] ?? null) : null

    // Ensure vendor exists in map (may have been added inline in old ROs)
    if (vName && !vendorId) {
      const ex2 = await dest.vendor.findUnique({ where: { name: vName } })
      if (ex2) {
        vendorNameMap[vName] = ex2.id
      } else {
        const nv = await dest.vendor.create({ data: { name: vName, isActive: true } })
        vendorNameMap[vName] = nv.id
        log(`  + (inline vendor) ${vName} → id ${nv.id}`)
      }
    }
    const resolvedVendorId = vName ? (vendorNameMap[vName] ?? null) : null

    const n = await dest.rO.create({
      data: {
        roNumber,
        vehicleYear:             ro.vehicle_year   || ro.vehicleYear   || null,
        vehicleMake:             ro.vehicle_make   || ro.vehicleMake   || null,
        vehicleModel:            ro.vehicle_model  || ro.vehicleModel  || null,
        vehicleColor:            ro.vehicle_color  || ro.vehicleColor  || null,
        vin:                     ro.vin            || null,
        vendorId:                resolvedVendorId,
        partsStatus:             mapPartsStatus(ro.parts_status || ro.partsStatus),
        productionStage:         ro.production_stage          || ro.productionStage          || 'Unassigned',
        productionStatusNote:    ro.production_status_note    || ro.productionStatusNote     || null,
        productionWaitingParts:  (ro.production_waiting_parts || ro.productionWaitingParts)
                                   ? String(ro.production_waiting_parts || ro.productionWaitingParts)
                                   : null,
        productionNextStep:      ro.production_next_step      || ro.productionNextStep       || null,
        productionFinalSupplement: toBool(ro.production_final_supplement ?? ro.productionFinalSupplement),
        productionSupplementNote:  ro.production_supplement_note || ro.productionSupplementNote || null,
        productionUpdatedAt:     toDate(ro.production_updated_at || ro.productionUpdatedAt),
        isArchived:              toBool(ro.is_archived  ?? ro.isArchived  ?? false),
        archivedAt:              toDate(ro.archived_at  || ro.archivedAt),
        createdAt:               toDate(ro.created_at   || ro.createdAt) || new Date(),
      },
    })
    roIdMap[ro.id] = n.id
    log(`  + RO ${roNumber}${toBool(ro.is_archived) ? ' [archived]' : ''} → id ${n.id}`)
    roCreated++
  }
  log(`  ROs: ${roCreated} created, ${roSkipped} skipped`)

  // ── 3. Parts ────────────────────────────────────────────────
  log('\n── Parts ───────────────────────────────────────────────────')
  let oldParts = []
  try {
    oldParts = await src.$queryRawUnsafe('SELECT * FROM parts ORDER BY id ASC')
  } catch (e) { log(`  [WARN] ${e.message}`) }
  log(`  ${oldParts.length} parts in source`)

  const partIdMap = {}
  let partsCreated = 0, partsSkipped = 0

  for (const p of oldParts) {
    const destROId = roIdMap[p.ro_id || p.roId]
    if (!destROId) { partsSkipped++; continue }

    const partNumber  = p.part_number  || p.partNumber  || null
    const description = p.description  || null
    const ex = await dest.part.findFirst({ where: { roId: destROId, partNumber, description } })
    if (ex) { partIdMap[p.id] = ex.id; partsSkipped++; continue }

    const n = await dest.part.create({
      data: {
        roId:        destROId,
        qty:         parseInt(p.qty) || 1,
        partNumber,
        description: description || partNumber || '',
        dateOrdered: toDate(p.date_ordered || p.dateOrdered),
        etaDate:     toDate(p.eta_date || p.etaDate),
        finishStatus: mapFinishStatus(p.finish_status || p.finishStatus),
        isReceived:  toBool(p.is_received ?? p.isReceived ?? false),
        hasCore:     toBool(p.has_core    ?? p.hasCore    ?? false),
        receivedAt:  toDate(p.received_at || p.receivedAt),
        price:       p.price != null ? parseFloat(p.price) : null,
        createdAt:   toDate(p.created_at || p.createdAt) || new Date(),
      },
    })
    partIdMap[p.id] = n.id
    partsCreated++
  }
  log(`  Parts: ${partsCreated} created, ${partsSkipped} skipped`)

  // ── 4. Part Photos ───────────────────────────────────────────
  log('\n── Part Photos ─────────────────────────────────────────────')
  let oldPhotos = []
  try {
    oldPhotos = await src.$queryRawUnsafe('SELECT * FROM part_photos ORDER BY id ASC')
  } catch (e) { log(`  [WARN] ${e.message}`) }
  log(`  ${oldPhotos.length} photos in source (DB records; files need separate transfer)`)

  let photosCreated = 0
  for (const ph of oldPhotos) {
    const destPartId = partIdMap[ph.part_id || ph.partId]
    if (!destPartId) continue
    const storedPath = ph.stored_path || ph.storedPath || ph.file_path || ''
    const ex = await dest.partPhoto.findFirst({ where: { partId: destPartId, storedPath } })
    if (ex) continue
    await dest.partPhoto.create({
      data: {
        partId:           destPartId,
        originalFilename: ph.original_filename || ph.originalFilename || ph.filename || 'photo.jpg',
        storedPath:       storedPath,
        createdAt:        toDate(ph.created_at || ph.createdAt) || new Date(),
      },
    })
    photosCreated++
  }
  log(`  Photos: ${photosCreated} created`)

  // ── 5. RO Invoices ───────────────────────────────────────────
  log('\n── RO Invoices ─────────────────────────────────────────────')
  let oldInvoices = []
  try {
    oldInvoices = await src.$queryRawUnsafe('SELECT * FROM ro_invoices ORDER BY id ASC')
  } catch (e) { log(`  [WARN] ${e.message}`) }
  log(`  ${oldInvoices.length} invoices`)

  let invCreated = 0
  for (const inv of oldInvoices) {
    const destROId = roIdMap[inv.ro_id || inv.roId]
    if (!destROId) continue
    const origFilename = inv.original_filename || inv.originalFilename || inv.filename
    const ex = await dest.rOInvoice.findFirst({ where: { roId: destROId, originalFilename: origFilename } })
    if (ex) continue
    await dest.rOInvoice.create({
      data: {
        roId:             destROId,
        originalFilename: origFilename || 'invoice.pdf',
        storedPath:       inv.stored_path || inv.storedPath || inv.file_path || '',
        uploadedBy:       inv.uploaded_by || inv.uploadedBy || null,
        createdAt:        toDate(inv.created_at || inv.createdAt) || new Date(),
      },
    })
    invCreated++
  }
  log(`  Invoices: ${invCreated} created`)

  // ── 6. SRC Entries ───────────────────────────────────────────
  log('\n── SRC Entries ─────────────────────────────────────────────')
  let oldSRC = []
  try {
    oldSRC = await src.$queryRawUnsafe('SELECT * FROM ro_src_entries ORDER BY id ASC')
  } catch (e) { log(`  [WARN] ${e.message}`) }
  log(`  ${oldSRC.length} SRC entries`)

  // Map old entry_type strings → SRCType enum
  function mapSRCType(v) {
    if (!v) return 'RETURN'
    const s = String(v).toLowerCase()
    if (s.includes('core')) return 'CORE_RETURN'
    return 'RETURN'
  }
  // Map old status strings → SRCStatus enum
  function mapSRCStatus(v) {
    if (!v) return 'OPEN'
    const s = String(v).toLowerCase()
    if (s === 'completed' || s === 'done' || s === 'closed') return 'COMPLETED'
    return 'OPEN'
  }

  let srcCreated = 0
  for (const e of oldSRC) {
    const destROId = roIdMap[e.ro_id || e.roId]
    if (!destROId) continue
    await dest.sRCEntry.create({
      data: {
        roId:        destROId,
        entryType:   mapSRCType(e.entry_type   || e.entryType),
        status:      mapSRCStatus(e.status),
        note:        e.note        || null,
        createdBy:   e.created_by  || e.createdBy  || null,
        completedAt: toDate(e.completed_at || e.completedAt),
        createdAt:   toDate(e.created_at   || e.createdAt) || new Date(),
      },
    })
    srcCreated++
  }
  log(`  SRC: ${srcCreated} created`)

  // ── 7. Activity Log ──────────────────────────────────────────
  log('\n── Activity Log ────────────────────────────────────────────')
  let oldActivity = []
  try {
    oldActivity = await src.$queryRawUnsafe('SELECT * FROM activity_log ORDER BY id ASC')
  } catch (e) { log(`  [WARN] ${e.message}`) }
  log(`  ${oldActivity.length} activity entries`)

  let actCreated = 0
  for (const a of oldActivity) {
    const destROId = roIdMap[a.ro_id || a.roId]
    if (!destROId) continue
    try {
      await dest.activityLog.create({
        data: {
          roId:      destROId,
          eventType: a.event_type || a.eventType || 'INFO',
          message:   a.message    || '',
          createdAt: toDate(a.created_at || a.createdAt) || new Date(),
        },
      })
      actCreated++
    } catch (e) {
      if (e.code === 'P2002') continue // skip unique constraint conflicts
      throw e
    }
  }
  log(`  Activity: ${actCreated} created`)

  // ── 8. Reset Sequences ───────────────────────────────────────
  // Reset BEFORE final step to avoid conflicts from previous partial runs
  log('\n── Pre-resetting sequences ─────────────────────────────────')
  const seqNamesEarly = ['activity_log_id_seq']
  for (const seq of seqNamesEarly) {
    try { await dest.$executeRawUnsafe(`ALTER SEQUENCE "${seq}" RESTART WITH 50000`) } catch (_) {}
  }

  log('\n── Resetting sequences ─────────────────────────────────────')
  const seqNames = ['users_id_seq','vendors_id_seq','ros_id_seq','parts_id_seq',
                    'part_photos_id_seq','ro_invoices_id_seq','src_entries_id_seq','activity_log_id_seq']
  for (const seq of seqNames) {
    try {
      await dest.$executeRawUnsafe(`ALTER SEQUENCE "${seq}" RESTART WITH 10000`)
      log(`  [seq] ${seq} → 10000`)
    } catch (_) {}
  }

  log('\n' + '='.repeat(60))
  log('✅ Migration complete!')
  log('\nNOTE: Photo FILES are stored on the old server\'s filesystem.')
  log('Photo DB records were migrated. To copy the actual photo files,')
  log('visit each RO on the new site — missing photos can be re-uploaded.')
  log('='.repeat(60))
}

main()
  .catch(err => { console.error('Migration failed:', err); process.exit(1) })
  .finally(() => Promise.all([src.$disconnect(), dest.$disconnect()]))
