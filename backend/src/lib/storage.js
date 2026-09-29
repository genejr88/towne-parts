// Uploaded files (part photos, invoices, location/SRC/inventory/private photos).
//
// They live in a Railway Storage Bucket (S3-compatible) under the same relative paths they
// had on the old /app/uploads volume — e.g. "parts/part-123.jpg", "invoices/invoice-456.pdf" —
// so every storedPath in the database and every /uploads/... URL keeps working unchanged.
// Moving off the volume is what lets Railway deploy Parts with zero downtime (services with a
// volume must be stopped before the new deploy starts).
//
// Reads try the bucket first and fall back to the local uploads directory, so files that are
// still only on disk keep working. With no UPLOADS_S3_* env vars (local dev) everything stays
// on local disk exactly as before.
const fs = require('fs')
const path = require('path')

const LOCAL_ROOT = path.join(__dirname, '../../uploads')
const BUCKET = process.env.UPLOADS_S3_BUCKET
const enabled = !!(BUCKET && process.env.UPLOADS_S3_ENDPOINT && process.env.UPLOADS_S3_ACCESS_KEY_ID && process.env.UPLOADS_S3_SECRET_ACCESS_KEY)

let s3, S3
if (enabled) {
  S3 = require('@aws-sdk/client-s3')
  s3 = new S3.S3Client({
    endpoint: process.env.UPLOADS_S3_ENDPOINT,
    region: process.env.UPLOADS_S3_REGION || 'auto',
    credentials: { accessKeyId: process.env.UPLOADS_S3_ACCESS_KEY_ID, secretAccessKey: process.env.UPLOADS_S3_SECRET_ACCESS_KEY },
  })
}
console.log(`[storage] uploads → ${enabled ? `bucket ${BUCKET} (disk fallback for reads)` : 'local disk'}`)

const TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.heic': 'image/heic', '.heif': 'image/heif', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
}
const typeOf = key => TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream'

// Keys are always "folder/file" with forward slashes, never escaping the uploads root.
function cleanKey(key) {
  const k = path.posix.normalize(String(key).replace(/\\/g, '/')).replace(/^\/+/, '')
  if (!k || k.startsWith('..')) throw new Error('Bad storage key')
  return k
}
const localPath = key => path.join(LOCAL_ROOT, ...cleanKey(key).split('/'))

// After multer has written req.file to disk: copy it into the bucket under `folder/filename`
// and drop the local copy. Call BEFORE creating the DB row, so a row never points at a file
// that failed to store. No-op without a bucket (the file is already in the right local place).
async function save(file, folder) {
  if (!file) return
  const key = cleanKey(`${folder}/${file.filename}`)
  file.storageKey = key
  if (!enabled) return
  await s3.send(new S3.PutObjectCommand({ Bucket: BUCKET, Key: key, Body: fs.readFileSync(file.path), ContentType: typeOf(key) }))
  try { fs.unlinkSync(file.path) } catch {}
}

// Undo an upload whose DB write failed / was rejected: remove the local file and any bucket copy.
async function discard(file) {
  if (!file) return
  try { if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path) } catch {}
  if (enabled && file.storageKey) await remove(file.storageKey)
}

// Delete a stored file everywhere it might be (bucket + local). Never throws.
async function remove(key) {
  let k
  try { k = cleanKey(key) } catch { return }
  if (enabled) {
    try { await s3.send(new S3.DeleteObjectCommand({ Bucket: BUCKET, Key: k })) } catch (e) { console.error(`[storage] delete ${k}:`, e.message) }
  }
  try { const p = localPath(k); if (fs.existsSync(p)) fs.unlinkSync(p) } catch {}
}

// Stream a stored file to the response (bucket first, then local disk). Supports Range
// requests (PDF viewers use them). Returns false if the file doesn't exist anywhere.
async function send(req, res, key, { filename, cacheSeconds } = {}) {
  const k = cleanKey(key)
  if (filename) res.setHeader('Content-Disposition', `inline; filename="${String(filename).replace(/"/g, '')}"`)
  if (cacheSeconds) res.setHeader('Cache-Control', `public, max-age=${cacheSeconds}, immutable`)
  if (enabled) {
    try {
      const out = await s3.send(new S3.GetObjectCommand({ Bucket: BUCKET, Key: k, Range: req.headers.range || undefined }))
      res.status(out.ContentRange ? 206 : 200)
      res.setHeader('Content-Type', out.ContentType || typeOf(k))
      res.setHeader('Accept-Ranges', 'bytes')
      if (out.ContentLength != null) res.setHeader('Content-Length', out.ContentLength)
      if (out.ContentRange) res.setHeader('Content-Range', out.ContentRange)
      if (out.ETag) res.setHeader('ETag', out.ETag)
      if (req.method === 'HEAD') { res.end(); out.Body.destroy && out.Body.destroy(); return true }
      out.Body.on('error', err => { console.error(`[storage] stream ${k}:`, err.message); res.destroy(err) })
      out.Body.pipe(res)
      return true
    } catch (e) {
      const status = e.$metadata && e.$metadata.httpStatusCode
      if (status === 416) { res.status(416).end(); return true }
      if (status !== 404 && e.name !== 'NoSuchKey') console.error(`[storage] get ${k}:`, e.name, e.message)
      // fall through to local disk
    }
  }
  const p = localPath(k)
  if (!fs.existsSync(p)) return false
  await new Promise((resolve, reject) => res.sendFile(p, err => (err && !res.headersSent ? reject(err) : resolve())))
  return true
}

// GET /uploads/* — public URLs the frontend uses for photos. /uploads/private/* is NOT public
// (private files are served by the authenticated /api/private route).
async function serveUploads(req, res, next) {
  try {
    // Mounted as app.get('/uploads/*') — the part after /uploads/ is params[0] (already decoded)
    const key = String(req.params[0] || '').replace(/^\/+/, '')
    if (!key || /^private(\/|$)/i.test(key)) return res.status(404).end()
    const found = await send(req, res, key, { cacheSeconds: 31536000 })
    if (!found) res.status(404).end()
  } catch (err) {
    if (err.message === 'Bad storage key') return res.status(400).end()
    next(err)
  }
}

module.exports = { enabled, save, discard, remove, send, serveUploads, LOCAL_ROOT }
