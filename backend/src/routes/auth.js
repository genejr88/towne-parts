const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

const SALT_ROUNDS = 12
const JWT_SECRET = process.env.JWT_SECRET || 'towneparts-secret'

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' })
  }

  try {
    const identifier = username.toLowerCase().trim()

    const user = await prisma.user.findUnique({ where: { username: identifier } })

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid username or password.' })
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid username or password.' })
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' })

    return res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      },
    })
  } catch (err) {
    console.error('Login error:', err)
    return res.status(500).json({ success: false, error: 'Internal server error.' })
  }
})

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  return res.json({ success: true, data: { message: 'Logged out successfully.' } })
})

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  return res.json({ success: true, data: req.user })
})

// PUT /api/auth/change-password
router.put('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Current and new passwords are required.' })
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' })
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } })

    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect.' })
    }

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS)
    await prisma.user.update({ where: { id: req.user.id }, data: { password: hashed } })

    return res.json({ success: true, data: { message: 'Password changed successfully.' } })
  } catch (err) {
    console.error('Change password error:', err)
    return res.status(500).json({ success: false, error: 'Internal server error.' })
  }
})

module.exports = router
