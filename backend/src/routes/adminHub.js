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

// DELETE /users/:id — never cascades: rows that require a user (rentals, photos, spins…)
// make the database refuse (P2003), and we report that instead of deleting history.
router.delete('/users/:id', async (req, res) => {
  try {
    const users = await prisma.user.findMany()
    const user = users.find(u => String(u.id) === String(req.params.id))
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' })
    const isAdmin = u => /admin/i.test(String(u.role || ''))
    if (users.length <= 1) {
      return res.status(409).json({ success: false, error: "Can't delete the only user in this app." })
    }
    if (isAdmin(user) && users.filter(isAdmin).length <= 1) {
      return res.status(409).json({ success: false, error: "Can't delete the last admin in this app." })
    }
    try {
      await prisma.user.delete({ where: { id: user.id } })
    } catch (err) {
      if (err.code === 'P2003' || err.code === 'P2014') {
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

module.exports = router
