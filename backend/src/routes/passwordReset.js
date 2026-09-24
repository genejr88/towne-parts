// PIN-gated password reset ("Forgot password?" on the login page).
// The shared PIN lives in the RESET_PIN env var — set it for every Towne app at once with
// Desktop/towne-accounts: `node accounts.js pin`. No RESET_PIN set -> feature is off.
// Wrong PINs answer 403 (not 401) so the frontend's 401 -> /login redirect doesn't fire.
const express = require('express')
const crypto = require('crypto')
const prisma = require('../lib/prisma')

let bcrypt
try { bcrypt = require('bcrypt') } catch { bcrypt = require('bcryptjs') }

const router = express.Router()

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILS_PER_IP = 5
const MAX_FAILS_TOTAL = 20 // across all IPs, so rotating addresses can't brute-force the PIN
let failures = [] // { ip, at }

function isLocked(ip) {
  const since = Date.now() - WINDOW_MS
  failures = failures.filter(f => f.at > since)
  return failures.length >= MAX_FAILS_TOTAL || failures.filter(f => f.ip === ip).length >= MAX_FAILS_PER_IP
}

function sha(v) { return crypto.createHash('sha256').update(String(v)).digest() }

// Sends the error response itself and returns false when the PIN check fails.
function checkPin(req, res) {
  const expected = process.env.RESET_PIN
  if (!expected) {
    res.status(404).json({ success: false, error: 'Password reset is not set up for this app.' })
    return false
  }
  if (isLocked(req.ip)) {
    res.status(429).json({ success: false, error: 'Too many wrong PINs. Try again in 15 minutes.' })
    return false
  }
  if (!crypto.timingSafeEqual(sha((req.body && req.body.pin) || ''), sha(expected))) {
    failures.push({ ip: req.ip, at: Date.now() })
    res.status(403).json({ success: false, error: 'Incorrect PIN.' })
    return false
  }
  return true
}

const label = u => u.username || u.email

// POST /api/auth/reset/verify-pin  { pin } -> list of accounts to pick from
router.post('/verify-pin', async (req, res) => {
  if (!checkPin(req, res)) return
  try {
    const users = await prisma.user.findMany()
    const data = users
      .map(u => ({ id: u.id, username: label(u), name: u.name || null }))
      .sort((a, b) => String(a.username).localeCompare(String(b.username)))
    return res.json({ success: true, data })
  } catch (err) {
    console.error('Reset verify error:', err)
    return res.status(500).json({ success: false, error: 'Internal server error.' })
  }
})

// POST /api/auth/reset  { pin, userId, newPassword }
router.post('/', async (req, res) => {
  if (!checkPin(req, res)) return
  const { userId, newPassword } = req.body || {}
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' })
  }
  try {
    // ids are Int in some apps and cuid strings in others — match loosely.
    const user = (await prisma.user.findMany()).find(u => String(u.id) === String(userId))
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' })
    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(newPassword, 12) } })
    console.log(`[password-reset] ${label(user)} reset via PIN from ${req.ip}`)
    return res.json({ success: true, data: { username: label(user) } })
  } catch (err) {
    console.error('Reset error:', err)
    return res.status(500).json({ success: false, error: 'Internal server error.' })
  }
})

module.exports = router
