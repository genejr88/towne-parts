const express = require('express')
const bcrypt = require('bcryptjs')
const prisma = require('../lib/prisma')
const { requireAuth, requireAdmin } = require('../middleware/auth')

const router = express.Router()

const SALT_ROUNDS = 12

function formatUser(u) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
  }
}

const USER_SELECT = { id: true, username: true, role: true, createdAt: true }

// GET /api/users — list all users (admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { username: 'asc' },
    })
    return res.json({ success: true, data: users.map(formatUser) })
  } catch (err) {
    console.error('Get users error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/users — create user (admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role } = req.body

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' })
  }

  const validRoles = ['ADMIN', 'USER']
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role. Must be ADMIN or USER.' })
  }

  try {
    const identifier = username.toLowerCase().trim()

    const existing = await prisma.user.findUnique({ where: { username: identifier } })
    if (existing) {
      return res.status(409).json({ success: false, error: 'A user with that username already exists.' })
    }

    const hashed = await bcrypt.hash(password, SALT_ROUNDS)

    const user = await prisma.user.create({
      data: {
        username: identifier,
        password: hashed,
        role: role || 'USER',
      },
      select: USER_SELECT,
    })

    return res.status(201).json({ success: true, data: formatUser(user) })
  } catch (err) {
    console.error('Create user error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// PUT /api/users/:id — update user (admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  const { username, password, role } = req.body

  const validRoles = ['ADMIN', 'USER']
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role. Must be ADMIN or USER.' })
  }

  try {
    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'User not found.' })
    }

    if (username) {
      const identifier = username.toLowerCase().trim()
      if (identifier !== existing.username) {
        const taken = await prisma.user.findUnique({ where: { username: identifier } })
        if (taken) {
          return res.status(409).json({ success: false, error: 'A user with that username already exists.' })
        }
      }
    }

    const updateData = {}
    if (username) updateData.username = username.toLowerCase().trim()
    if (role) updateData.role = role
    if (password) updateData.password = await bcrypt.hash(password, SALT_ROUNDS)

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: USER_SELECT,
    })

    return res.json({ success: true, data: formatUser(user) })
  } catch (err) {
    console.error('Update user error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/users/:id — remove user (admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)

  if (req.user.id === id) {
    return res.status(400).json({ success: false, error: 'You cannot delete your own account.' })
  }

  try {
    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'User not found.' })
    }

    await prisma.user.delete({ where: { id } })

    return res.json({ success: true, data: { message: 'User deleted.' } })
  } catch (err) {
    console.error('Delete user error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
