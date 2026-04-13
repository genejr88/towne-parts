/**
 * migrate.js — Import old TownePartsManager SQLite data into new Railway PostgreSQL API
 *
 * Usage:
 *   node migrate.js
 *
 * Set BACKEND_URL env var if backend isn't at the default below.
 * Old DB is read from the local machine path hard-coded below.
 */

const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')
const axios = require('axios')
const FormData = require('form-data')

// ── Config ────────────────────────────────────────────────────────────────────
const BACKEND_URL = process.env.BACKEND_URL || 'https://towne-parts-backend-production.up.railway.app'
const OLD_DB_PATH = 'C:/Users/towne/AppData/Local/TownePartsManager/towne_parts_manager.db'
const OLD_PHOTOS_ROOT = 'C:/Users/towne/AppData/Local/TownePartsManager'
const USERNAME = 'gene'
const PASSWORD = 'TowneParts1'

// ── Value mappings ────────────────────────────────────────────────────────────
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
  return oldStage // stages match: disassembly, body, paint, reassembly, qc_detail, completed, etc.
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
let authToken = null

async function login() {
  console.log(`\nLogging in as ${USERNAME}...`)
  const res = await axios.post(`${BACKEND_URL}/api/auth/login`, { username: USERNAME, password: PASSWORD })
  authToken = res.data.data.token
  console.log('✓ Logged in')
}

function api(method, url, data, isForm = false) {
  const headers = { Authorization: `Bearer ${authToken}` }
  if (isForm) {
    Object.assign(headers, data.getHeaders())
  }
  return axios({ method, url: `${BACKEND_URL}${url}`, data, headers })
}

// ── Main migration ────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60))
  console.log('Towne Parts — Database Migration')
  console.log('='.repeat(60))
  console.log(`Backend: ${BACKEND_URL}`)
  console.log(`Source DB: ${OLD_DB_PATH}`)

  // Open old DB
  if (!fs.existsSync(OLD_DB_PATH)) {
    console.error(`ERROR: Old database not found at ${OLD_DB_PATH}`)
    process.exit(1)
  }
  const oldDb = new Database(OLD_DB_PATH, { readonly: true })
  console.log('\n✓ Old database opened')

  // Login
  await login()

  // ── Step 1: Create vendors ──────────────────────────────────────────────────
  console.log('\n── Step 1: Vendors ────────────────────────────────────')
  const oldVendors = oldDb.prepare('SELECT * FROM vendors WHERE is_active = 1 ORDER BY id').all()
  console.log(`Found ${oldVendors.length} active vendors in old DB`)

  // Get existing vendors from new DB
  const existingVendorsRes = await api('GET', '/api/vendors?all=true')
  const existingVendors = existingVendorsRes.data.data
  const vendorNameToId = {}
  existingVendors.forEach(v => { vendorNameToId[v.name.toLowerCase()] = v.id })

  for (const ov of oldVendors) {
    const nameLower = ov.name.toLowerCase()
    if (vendorNameToId[nameLower]) {
      console.log(`  - ${ov.name} → already exists (id ${vendorNameToId[nameLower]})`)
      continue
    }
    try {
      const res = await api('POST', '/api/vendors', { name: ov.name })
      vendorNameToId[nameLower] = res.data.data.id
      console.log(`  + ${ov.name} → created (id ${res.data.data.id})`)
    } catch (err) {
      if (err.response?.status === 409) {
        // Already exists under a slightly different casing — re-fetch
        const refetch = await api('GET', '/api/vendors?all=true')
        refetch.data.data.forEach(v => { vendorNameToId[v.name.toLowerCase()] = v.id })
        console.log(`  ~ ${ov.name} → found after 409`)
      } else {
        console.warn(`  ! Failed to create vendor "${ov.name}":`, err.response?.data?.error || err.message)
      }
    }
  }

  // Build old-vendor-name → new-vendor-id lookup
  function resolveVendorId(vendorName) {
    if (!vendorName) return null
    return vendorNameToId[vendorName.toLowerCase()] || null
  }

  // ── Step 2: Create ROs ─────────────────────────────────────────────────────
  console.log('\n── Step 2: Repair Orders ──────────────────────────────')
  const oldROs = oldDb.prepare('SELECT * FROM ros ORDER BY id').all()
  console.log(`Found ${oldROs.length} ROs in old DB`)

  // Check existing ROs in new DB to avoid duplicates
  let existingROsRes
  try {
    existingROsRes = await api('GET', '/api/ros?limit=500&archived=all')
  } catch {
    existingROsRes = await api('GET', '/api/ros?limit=500')
  }

  const existingRONumbers = new Set()
  const oldIdToNewId = {} // old RO id → new RO id

  ;(existingROsRes.data.data || []).forEach(ro => existingRONumbers.add(ro.roNumber))

  let roCreated = 0, roSkipped = 0

  for (const ro of oldROs) {
    if (existingRONumbers.has(ro.ro_number)) {
      // Find its new ID
      const match = (existingROsRes.data.data || []).find(r => r.roNumber === ro.ro_number)
      if (match) oldIdToNewId[ro.id] = match.id
      console.log(`  ~ RO ${ro.ro_number} — skipped (already exists)`)
      roSkipped++
      continue
    }

    const vendorId = resolveVendorId(ro.vendor_name)

    try {
      // Create the RO
      const createRes = await api('POST', '/api/ros', {
        roNumber: ro.ro_number,
        vehicleYear: ro.vehicle_year || null,
        vehicleMake: ro.vehicle_make || null,
        vehicleModel: ro.vehicle_model || null,
        vehicleColor: null,
        vin: ro.vin || null,
        vendorId: vendorId || undefined,
      })

      const newRO = createRes.data.data
      oldIdToNewId[ro.id] = newRO.id

      // Update the RO with extra fields (partsStatus, productionStage, isArchived)
      const updatePayload = {
        partsStatus: mapPartsStatus(ro.parts_status),
        productionStage: mapProductionStage(ro.production_stage),
        productionStatusNote: ro.production_status_note || null,
        productionWaitingParts: ro.production_waiting_parts || null,
        productionNextStep: ro.production_next_step || null,
        productionFinalSupplement: Boolean(ro.production_final_supplement),
        productionSupplementNote: ro.production_supplement_note || null,
        isArchived: Boolean(ro.is_archived),
        archivedAt: ro.archived_at ? new Date(ro.archived_at).toISOString() : null,
      }

      await api('PUT', `/api/ros/${newRO.id}`, updatePayload)

      console.log(`  + RO ${ro.ro_number} → new id ${newRO.id}${ro.is_archived ? ' [archived]' : ''}`)
      roCreated++
    } catch (err) {
      console.error(`  ! Failed to create RO ${ro.ro_number}:`, err.response?.data?.error || err.message)
    }
  }

  console.log(`\nROs: ${roCreated} created, ${roSkipped} skipped`)

  // ── Step 3: Create Parts ───────────────────────────────────────────────────
  console.log('\n── Step 3: Parts ───────────────────────────────────────')
  const oldParts = oldDb.prepare('SELECT * FROM parts ORDER BY id').all()
  console.log(`Found ${oldParts.length} parts in old DB`)

  const oldPartIdToNewId = {} // old part id → new part id
  let partsCreated = 0, partsSkipped = 0

  for (const part of oldParts) {
    const newROId = oldIdToNewId[part.ro_id]
    if (!newROId) {
      console.warn(`  ! Part ${part.id} — no new RO found for old RO id ${part.ro_id}, skipping`)
      partsSkipped++
      continue
    }

    try {
      const res = await api('POST', `/api/parts/ro/${newROId}`, {
        qty: part.qty ? Math.round(part.qty) : 1,
        partNumber: part.part_number || null,
        description: part.description || null,
        dateOrdered: part.date_ordered ? new Date(part.date_ordered).toISOString() : null,
        etaDate: part.eta_date ? new Date(part.eta_date).toISOString() : null,
        finishStatus: mapFinishStatus(part.finish_status),
        isReceived: Boolean(part.is_received),
        hasCore: Boolean(part.has_core),
        price: part.price != null ? part.price : null,
      })

      oldPartIdToNewId[part.id] = res.data.data.id
      console.log(`  + Part ${part.id} (${part.description || part.part_number || 'unnamed'}) → new id ${res.data.data.id}`)
      partsCreated++
    } catch (err) {
      console.error(`  ! Failed to create part ${part.id}:`, err.response?.data?.error || err.message)
      partsSkipped++
    }
  }

  console.log(`\nParts: ${partsCreated} created, ${partsSkipped} skipped`)

  // ── Step 4: Upload Photos ──────────────────────────────────────────────────
  console.log('\n── Step 4: Photos ──────────────────────────────────────')
  const oldPhotos = oldDb.prepare('SELECT * FROM part_photos ORDER BY id').all()
  console.log(`Found ${oldPhotos.length} photos in old DB`)

  let photosUploaded = 0, photosMissing = 0, photosSkipped = 0

  for (const photo of oldPhotos) {
    const newPartId = oldPartIdToNewId[photo.part_id]
    if (!newPartId) {
      console.warn(`  ! Photo ${photo.id} — no new part found for old part id ${photo.part_id}, skipping`)
      photosSkipped++
      continue
    }

    // Resolve file path — stored_relative_path is like "part_photos\part_92\photo_6_f4c71ea7.jpeg"
    const normalizedRelPath = photo.stored_relative_path.replace(/\\/g, '/')
    const fullPath = path.join(OLD_PHOTOS_ROOT, normalizedRelPath)

    if (!fs.existsSync(fullPath)) {
      console.warn(`  ! Photo ${photo.id} — file not found: ${fullPath}`)
      photosMissing++
      continue
    }

    try {
      const form = new FormData()
      form.append('file', fs.createReadStream(fullPath), {
        filename: photo.original_filename || path.basename(fullPath),
        contentType: photo.content_type || 'image/jpeg',
      })

      await api('POST', `/api/parts/${newPartId}/photos`, form, true)
      console.log(`  + Photo ${photo.id} (${photo.original_filename}) → uploaded to part ${newPartId}`)
      photosUploaded++
    } catch (err) {
      console.error(`  ! Failed to upload photo ${photo.id}:`, err.response?.data?.error || err.message)
      photosSkipped++
    }
  }

  console.log(`\nPhotos: ${photosUploaded} uploaded, ${photosMissing} missing on disk, ${photosSkipped} skipped`)

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log('Migration Complete!')
  console.log('='.repeat(60))
  console.log(`  ROs:    ${roCreated} created, ${roSkipped} already existed`)
  console.log(`  Parts:  ${partsCreated} created, ${partsSkipped} skipped`)
  console.log(`  Photos: ${photosUploaded} uploaded, ${photosMissing} not found on disk, ${photosSkipped} skipped`)
  console.log('')
  console.log('⚠️  Note: Photos are stored on Railway\'s ephemeral filesystem.')
  console.log('   They will be lost if the backend service is redeployed.')
  console.log('   Consider adding cloud storage (Cloudinary/S3) for permanence.')

  oldDb.close()
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message)
  if (err.response?.data) console.error('API response:', err.response.data)
  process.exit(1)
})
