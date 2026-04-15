/**
 * run-migration.js
 * Pulls everything from the OLD server and pushes it to the NEW server.
 *
 * Usage:
 *   SOURCE_URL=https://faithful-reprieve.up.railway.app \
 *   DEST_URL=https://shimmering-rebirth.up.railway.app \
 *   ADMIN_KEY=your-secret-key \
 *   node prisma/run-migration.js
 */

const https  = require('https')
const http   = require('http')

const SOURCE_URL = process.env.SOURCE_URL
const DEST_URL   = process.env.DEST_URL
const ADMIN_KEY  = process.env.ADMIN_KEY

if (!SOURCE_URL || !DEST_URL || !ADMIN_KEY) {
  console.error('Set SOURCE_URL, DEST_URL, and ADMIN_KEY env vars')
  process.exit(1)
}

function request(url, opts, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib    = parsed.protocol === 'https:' ? https : http
    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   opts.method || 'GET',
      headers:  { 'x-admin-key': ADMIN_KEY, 'content-type': 'application/json', ...(opts.headers || {}) },
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }) }
        catch { resolve({ status: res.statusCode, data: raw }) }
      })
    })
    req.on('error', reject)
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body))
    req.end()
  })
}

async function main() {
  console.log('='.repeat(60))
  console.log(`SOURCE: ${SOURCE_URL}`)
  console.log(`DEST:   ${DEST_URL}`)
  console.log('='.repeat(60))

  // Step 1: Export from old server
  console.log('\n[1/2] Exporting from old server…')
  const exportRes = await request(`${SOURCE_URL}/api/admin/export`, { method: 'GET' })
  if (exportRes.status !== 200) {
    console.error('Export failed:', exportRes.status, exportRes.data)
    process.exit(1)
  }
  const payload = exportRes.data
  const { db, files } = payload
  console.log(`  vendors=${db.vendors?.length} ros=${db.ros?.length} parts=${db.parts?.length} photos=${db.partPhotos?.length} files=${files?.length}`)

  // Step 2: Import to new server
  console.log('\n[2/2] Importing to new server…')
  const importRes = await request(`${DEST_URL}/api/admin/import`, { method: 'POST' }, payload)
  if (importRes.status !== 200) {
    console.error('Import failed:', importRes.status, importRes.data)
    process.exit(1)
  }
  console.log('  Result:', importRes.data)

  console.log('\n✅ Migration complete!')
}

main().catch(err => { console.error(err); process.exit(1) })
