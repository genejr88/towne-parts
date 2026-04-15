/**
 * upload-photos-to-railway.js
 *
 * The migration already wrote PartPhoto records to the DB pointing to local filenames.
 * This script:
 *   1. Reads those records + local files
 *   2. Deletes the local-only DB records
 *   3. Re-uploads each file to Railway via the API (which creates correct records)
 *
 * Run from backend/ dir:
 *   node prisma/upload-photos-to-railway.js
 */

require('dotenv').config()
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const FormData = require('form-data')
const { PrismaClient } = require('@prisma/client')

const BACKEND_URL = 'https://towne-parts-production.up.railway.app'
const LOCAL_PHOTOS_DIR = path.join(__dirname, '../uploads/parts')
const USERNAME = 'gene'
const PASSWORD = 'TowneParts1'

const prisma = new PrismaClient()

async function main() {
  console.log('='.repeat(60))
  console.log('Uploading Photos to Railway Backend')
  console.log('='.repeat(60))

  // Login
  console.log('\nLogging in...')
  const loginRes = await axios.post(`${BACKEND_URL}/api/auth/login`, { username: USERNAME, password: PASSWORD })
  const token = loginRes.data.data.token
  console.log('✓ Logged in')

  // Get all photo records from DB
  const photos = await prisma.partPhoto.findMany({ orderBy: { id: 'asc' } })
  console.log(`\nFound ${photos.length} photo records in DB`)

  let uploaded = 0, missing = 0, failed = 0

  for (const photo of photos) {
    const localPath = path.join(LOCAL_PHOTOS_DIR, photo.storedPath)

    if (!fs.existsSync(localPath)) {
      console.warn(`  ! Photo id ${photo.id} — local file missing: ${photo.storedPath}`)
      missing++
      continue
    }

    // Delete the existing DB record first
    await prisma.partPhoto.delete({ where: { id: photo.id } })

    // Upload the file to Railway
    const form = new FormData()
    form.append('file', fs.createReadStream(localPath), {
      filename: photo.originalFilename || path.basename(localPath),
      contentType: 'image/jpeg',
    })

    try {
      await axios.post(`${BACKEND_URL}/api/parts/${photo.partId}/photos`, form, {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
        maxBodyLength: Infinity,
      })
      console.log(`  ✓ Photo ${photo.id} → part ${photo.partId} uploaded to Railway`)
      uploaded++
    } catch (err) {
      console.error(`  ! Photo ${photo.id} upload failed:`, err.response?.data?.error || err.message)
      failed++
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log(`Done! ${uploaded} uploaded, ${missing} files missing, ${failed} failed`)

  await prisma.$disconnect()
}

main().catch(async err => {
  console.error('FATAL:', err.message)
  await prisma.$disconnect()
  process.exit(1)
})
