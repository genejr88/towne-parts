const express = require('express')
const prisma = require('../lib/prisma')
const { Prisma } = require('@prisma/client')
const { requireAuth, requireAdmin } = require('../middleware/auth')

const router = express.Router()

// Profile shown when someone taps a tech's photo on the after-the-fact TV screen. Free text,
// only these keys are kept; empty values are dropped.
const PROFILE_KEYS = { role: 80, since: 20, specialties: 200, languages: 120, about: 600, funFact: 300 }
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null
  const out = {}
  for (const [k, max] of Object.entries(PROFILE_KEYS)) {
    const v = String(p[k] ?? '').trim().slice(0, max)
    if (v) out[k] = v
  }
  return Object.keys(out).length ? out : null
}


// GET /api/technicians — list active techs (or all with ?all=true)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { all } = req.query
    const where = all === 'true' ? {} : { isActive: true }

    const techs = await prisma.technician.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    return res.json({ success: true, data: techs })
  } catch (err) {
    console.error('Get technicians error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/technicians — create (admin)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, sortOrder, profile } = req.body

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Technician name is required.' })
  }

  try {
    const existing = await prisma.technician.findUnique({ where: { name: name.trim() } })
    if (existing) {
      return res.status(409).json({ success: false, error: 'A technician with that name already exists.' })
    }

    const tech = await prisma.technician.create({
      data: {
        name: name.trim(),
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
        profile: cleanProfile(profile) ?? undefined,
      },
    })

    return res.status(201).json({ success: true, data: tech })
  } catch (err) {
    console.error('Create technician error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// PUT /api/technicians/:id — update (admin)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, isActive, sortOrder, profile } = req.body

  try {
    const existing = await prisma.technician.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Technician not found.' })
    }

    if (name && name.trim() !== existing.name) {
      const dup = await prisma.technician.findUnique({ where: { name: name.trim() } })
      if (dup) {
        return res.status(409).json({ success: false, error: 'A technician with that name already exists.' })
      }
    }

    const updateData = {}
    if (name      !== undefined) updateData.name      = name.trim()
    if (isActive  !== undefined) updateData.isActive  = Boolean(isActive)
    if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder) || 0
    if (profile   !== undefined) updateData.profile   = cleanProfile(profile) ?? Prisma.DbNull

    const tech = await prisma.technician.update({ where: { id }, data: updateData })
    return res.json({ success: true, data: tech })
  } catch (err) {
    console.error('Update technician error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/technicians/:id — soft delete (deactivate) by default; pass ?hard=true to remove entirely
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  const hard = req.query.hard === 'true'

  try {
    const existing = await prisma.technician.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Technician not found.' })
    }

    if (hard) {
      await prisma.technician.delete({ where: { id } })
      return res.json({ success: true })
    }

    const tech = await prisma.technician.update({
      where: { id },
      data: { isActive: false },
    })
    return res.json({ success: true, data: tech })
  } catch (err) {
    console.error('Delete technician error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
