/**
 * reupload-photos.js
 *
 * Clears all PartPhoto records from DB, then re-uploads every photo
 * directly from the original old SQLite source files to the Railway API.
 * This ensures the DB records match the files actually on Railway's disk.
 *
 * Run from backend/:
 *   node prisma/reupload-photos.js
 */

require('dotenv').config()
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const FormData = require('form-data')
const Database = require('better-sqlite3')
const { PrismaClient } = require('@prisma/client')

const BACKEND_URL = 'https://towne-parts-production.up.railway.app'
const OLD_DB_PATH = 'C:/Users/towne/AppData/Local/TownePartsManager/towne_parts_manager.db'
const OLD_PHOTOS_ROOT = 'C:/Users/towne/AppData/Local/TownePartsManager'
const USERNAME = 'gene'
const PASSWORD = 'TowneParts1'

const prisma = new PrismaClient()

async function main() {
  console.log('='.repeat(60))
  console.log('Re-uploading Photos to Railway (Persistent Volume)')
  console.log('='.repeat(60))

  const oldDb = new Database(OLD_DB_PATH, { readonly: true })

  // Login
  console.log('\nLogging in...')
  const loginRes = await axios.post(`${BACKEND_URL}/api/auth/login`, { username: USERNAME, password: PASSWORD })
  const token = loginRes.data.data.token
  console.log('✓ Logged in')

  // Step 1: Clear ALL existing photo records
  console.log('\nClearing existing photo records from DB...')
  const deleted = await prisma.partPhoto.deleteMany({})
  console.log(`✓ Deleted ${deleted.count} photo records`)

  // Step 2: Build ro_number → new RO id mapping
  const allNewROs = await prisma.rO.findMany({ select: { id: true, roNumber: true } })
  const roNumberToNewId = {}
  allNewROs.forEach(ro => { roNumberToNewId[ro.roNumber] = ro.id })

  // Step 3: Build (new_ro_id, description, partNumber) → new part id
  const allNewParts = await prisma.part.findMany({
    select: { id: true, roId: true, description: true, partNumber: true, createdAt: true }
  })
  // Index by roId for quick lookup
  const partsByRoId = {}
  allNewParts.forEach(p => {
    if (!partsByRoId[p.roId]) partsByRoId[p.roId] = []
    partsByRoId[p.roId].push(p)
  })

  // Step 4: Build old part_id → new part_id mapping
  const oldParts = oldDb.prepare('SELECT p.id, p.ro_id, p.description, p.part_number, r.ro_number FROM parts p JOIN ros r ON p.ro_id = r.id ORDER BY p.id').all()
  const oldPartIdToNewPartId = {}

  for (const op of oldParts) {
    const newROId = roNumberToNewId[op.ro_number]
    if (!newROId) continue

    const candidates = partsByRoId[newROId] || []
    // Match by description + partNumber
    let match = candidates.find(p =>
      (p.description || null) === (op.description || null) &&
      (p.partNumber || null) === (op.part_number || null)
    )
    // Fallback: match by description only
    if (!match) match = candidates.find(p => (p.description || null) === (op.description || null))
    // Fallback: match by partNumber only
    if (!match && op.part_number) match = candidates.find(p => (p.partNumber || null) === (op.part_number || null))

    if (match) {
      oldPartIdToNewPartId[op.id] = match.id
    } else {
      console.warn(`  ! Could not map old part ${op.id} (${op.description || op.part_number})`)
    }
  }

  console.log(`✓ Mapped ${Object.keys(oldPartIdToNewPartId).length} of ${oldParts.length} parts`)

  // Step 5: Upload each photo from original source files
  const oldPhotos = oldDb.prepare('SELECT * FROM part_photos ORDER BY id').all()
  console.log(`\nUploading ${oldPhotos.length} photos to Railway...\n`)

  let uploaded = 0, missing = 0, skipped = 0

  for (const photo of oldPhotos) {
    const newPartId = oldPartIdToNewPartId[photo.part_id]
    if (!newPartId) {
      console.warn(`  ! Photo ${photo.id} — no mapping for old part ${photo.part_id}, skipping`)
      skipped++
      continue
    }

    const normalizedRelPath = photo.stored_relative_path.replace(/\\/g, '/')
    const srcPath = path.join(OLD_PHOTOS_ROOT, normalizedRelPath)

    if (!fs.existsSync(srcPath)) {
      console.warn(`  ! Photo ${photo.id} — file not found: ${srcPath}`)
      missing++
      continue
    }

    const form = new FormData()
    form.append('file', fs.createReadStream(srcPath), {
      filename: photo.original_filename || path.basename(srcPath),
      contentType: photo.content_type || 'image/jpeg',
    })

    try {
      await axios.post(`${BACKEND_URL}/api/parts/${newPartId}/photos`, form, {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
        maxBodyLength: Infinity,
      })
      console.log(`  ✓ Photo ${photo.id} "${photo.original_filename}" → part ${newPartId}`)
      uploaded++
    } catch (err) {
      console.error(`  ! Photo ${photo.id} failed:`, err.response?.data?.error || err.message)
      skipped++
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log(`Done! ${uploaded} uploaded, ${missing} files not found, ${skipped} skipped`)
  console.log('\n✓ Photos are now on the persistent Railway volume.')
  console.log('  They will survive all future redeploys.')

  oldDb.close()
  await prisma.$disconnect()
}

main().catch(async err => {
  console.error('FATAL:', err.message)
  await prisma.$disconnect()
  process.exit(1)
})
