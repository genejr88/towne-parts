// Private admin API for Towne Control (towneapps.com/admin). Only the towneapps.com
// server calls this, sending TOWNE_ADMIN_KEY in the x-towne-admin-key header; browsers
// never see the key. With no TOWNE_ADMIN_KEY set the whole router is off (404).
// Set/rotate the key for every app at once: Desktop/towne-accounts `node accounts.js admin-key`.
const express = require('express')
const crypto = require('crypto')
const prisma = require('../lib/prisma')

let bcrypt
try { bcrypt = require('bcrypt') } catch { bcrypt = require('bcryptjs') }

const router = express.Router()

const sha = v => crypto.createHash('sha256').update(String(v)).digest()

router.use((req, res, next) => {
  const key = process.env.TOWNE_ADMIN_KEY
  if (!key) return res.status(404).json({ success: false, error: 'Not found' })
  if (!crypto.timingSafeEqual(sha(req.headers['x-towne-admin-key'] || ''), sha(key))) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  next()
})

router.get('/health', async (req, res) => {
  try {
    const users = await prisma.user.count()
    res.json({ success: true, data: { ok: true, users } })
  } catch (err) {
    res.status(500).json({ success: false, error: 'Database unreachable' })
  }
})

router.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany()
    const data = users
      .map(u => ({ id: u.id, username: u.username || u.email, email: u.email || null, name: u.name || null, role: u.role || null }))
      .sort((a, b) => String(a.username).localeCompare(String(b.username)))
    res.json({ success: true, data })
  } catch (err) {
    console.error('Admin hub users error:', err)
    res.status(500).json({ success: false, error: 'Internal server error.' })
  }
})

router.post('/users/:id/password', async (req, res) => {
  const password = req.body && req.body.password
  if (!password || String(password).length < 6) {
    return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' })
  }
  try {
    // ids are Int in some apps and cuid strings in others — match loosely.
    const user = (await prisma.user.findMany()).find(u => String(u.id) === String(req.params.id))
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' })
    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(String(password), 12) } })
    console.log(`[admin-hub] password set for ${user.username || user.email} via Towne Control`)
    res.json({ success: true, data: { username: user.username || user.email } })
  } catch (err) {
    console.error('Admin hub password error:', err)
    res.status(500).json({ success: false, error: 'Internal server error.' })
  }
})

// The database refusing to delete a user that other rows point at. Prisma reports this as
// P2003/P2014 for ON DELETE NO ACTION, but a RESTRICT constraint (what `prisma db push`
// creates for required relations, e.g. Spin) comes back as an unknown-request error with
// Postgres code 23001 — so check the underlying message too.
function isRecordsError(err) {
  if (err.code === 'P2003' || err.code === 'P2014') return true
  const m = String(err.message || '')
  return /(23001|23503)|violates (RESTRICT setting of )?foreign key constraint/.test(m)
}

// DELETE /users/:id — never cascades: rows that require a user (rentals, photos, spins…)
// make the database refuse (P2003), and we report that instead of deleting history.
router.delete('/users/:id', async (req, res) => {
  try {
    const users = await prisma.user.findMany()
    const user = users.find(u => String(u.id) === String(req.params.id))
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' })
    const refusal = removalRefusal(users, user)
    if (refusal) return res.status(409).json({ success: false, error: refusal.replace('remove', 'delete') })
    try {
      await prisma.user.delete({ where: { id: user.id } })
    } catch (err) {
      if (isRecordsError(err)) {
        return res.status(409).json({ success: false, error: 'This user has records in this app, so they can\'t be deleted. Reset their password instead.' })
      }
      throw err
    }
    console.log(`[admin-hub] user deleted: ${user.username || user.email} via Towne Control`)
    res.json({ success: true, data: { username: user.username || user.email } })
  } catch (err) {
    console.error('Admin hub delete error:', err)
    res.status(500).json({ success: false, error: 'Internal server error.' })
  }
})

// ── Directory sync (Towne Control → People) ──────────────────────────────────
// Towne Control keeps one person = one username + one bcrypt hash + the apps they may use,
// and pushes that here. Matching is by username only (case-insensitive).

// This app's User columns, from the Prisma schema — apps differ (email required or not, etc.)
let userFieldsCache
function userFields() {
  if (!userFieldsCache) {
    const { Prisma } = require('@prisma/client')
    userFieldsCache = Prisma.dmmf.datamodel.models.find(m => m.name === 'User').fields.filter(f => f.kind !== 'object')
  }
  return userFieldsCache
}
const byUsername = (users, username) => users.find(u => String(u.username || '').toLowerCase() === String(username).toLowerCase())

// PUT /users/by-username/:username { passwordHash, name?, email? } — create the account,
// or set its password if it already exists (existing name/role are left alone).
router.put('/users/by-username/:username', async (req, res) => {
  const { passwordHash, name, email } = req.body || {}
  if (!/^\$2[aby]\$\d{2}\$.{53}$/.test(String(passwordHash || ''))) {
    return res.status(400).json({ success: false, error: 'passwordHash must be a bcrypt hash.' })
  }
  const username = String(req.params.username).trim()
  try {
    const existing = byUsername(await prisma.user.findMany(), username)
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { password: passwordHash } })
      console.log(`[admin-hub] directory sync: updated ${username}`)
      return res.json({ success: true, data: { action: 'updated', username } })
    }
    const data = { password: passwordHash }
    for (const f of userFields()) {
      if (f.name === 'username') data.username = username
      else if (f.name === 'name') data.name = name || username
      else if (f.name === 'email' && (email || f.isRequired)) data.email = email || `${username.toLowerCase()}@users.towneapps.com`
    }
    const missing = userFields().filter(f => f.isRequired && !f.hasDefaultValue && !f.isUpdatedAt && !(f.name in data)).map(f => f.name)
    if (missing.length) return res.status(422).json({ success: false, error: `This app needs ${missing.join(', ')} to create a user.` })
    await prisma.user.create({ data })
    console.log(`[admin-hub] directory sync: created ${username}`)
    res.json({ success: true, data: { action: 'created', username } })
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'Another account in this app already uses that email or username.' })
    console.error('Admin hub directory upsert error:', err)
    res.status(500).json({ success: false, error: 'Internal server error.' })
  }
})

// DELETE /users/by-username/:username — remove access. Deletes the account, or, if it has
// history the database won't let go of, locks it with an unguessable password instead.
router.delete('/users/by-username/:username', async (req, res) => {
  try {
    const users = await prisma.user.findMany()
    const user = byUsername(users, req.params.username)
    if (!user) return res.json({ success: true, data: { action: 'none' } })
    const refusal = removalRefusal(users, user)
    if (refusal) return res.status(409).json({ success: false, error: refusal })
    try {
      await prisma.user.delete({ where: { id: user.id } })
      console.log(`[admin-hub] directory sync: deleted ${user.username}`)
      return res.json({ success: true, data: { action: 'deleted' } })
    } catch (err) {
      if (!isRecordsError(err)) throw err
    }
    const lock = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12)
    await prisma.user.update({ where: { id: user.id }, data: { password: lock } })
    console.log(`[admin-hub] directory sync: locked ${user.username} (has records)`)
    res.json({ success: true, data: { action: 'locked' } })
  } catch (err) {
    console.error('Admin hub directory remove error:', err)
    res.status(500).json({ success: false, error: 'Internal server error.' })
  }
})

function removalRefusal(users, user) {
  const isAdmin = u => /admin/i.test(String(u.role || ''))
  if (users.length <= 1) return "Can't remove the only user in this app."
  if (isAdmin(user) && users.filter(isAdmin).length <= 1) return "Can't remove the last admin in this app."
  return null
}

// GET /backup — every table in this app's database as gzipped JSON:
// { createdAt, tables: { name: [rows...] } }. Includes password hashes and customer data,
// so it only ever goes to Towne Control (root login) and never to a browser directly.
router.get('/backup', async (req, res) => {
  try {
    const tables = (await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
    )).map(r => r.table_name)
    const zlib = require('zlib')
    const gz = zlib.createGzip()
    res.setHeader('Content-Type', 'application/gzip')
    gz.pipe(res)
    // BigInt (int8 / counts) can't go through JSON.stringify — send as strings
    const json = v => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x))
    gz.write(`{"createdAt":${json(new Date())},"tables":{`)
    for (let i = 0; i < tables.length; i++) {
      const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${tables[i].replace(/"/g, '""')}"`)
      gz.write(`${i ? ',' : ''}${json(tables[i])}:${json(rows)}`)
    }
    gz.end('}}')
    console.log(`[admin-hub] backup: ${tables.length} tables via Towne Control`)
  } catch (err) {
    console.error('Admin hub backup error:', err)
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Backup failed.' })
    else res.destroy(err)
  }
})

module.exports = router
