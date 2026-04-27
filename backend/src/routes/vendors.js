const express = require('express')
const prisma = require('../lib/prisma')
const { requireAuth, requireAdmin } = require('../middleware/auth')

const router = express.Router()

// GET /api/vendors — list active vendors (or all with ?all=true)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { all } = req.query
    const where = all === 'true' ? {} : { isActive: true }

    const vendors = await prisma.vendor.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    })

    return res.json({ success: true, data: vendors })
  } catch (err) {
    console.error('Get vendors error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/vendors — create vendor (admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, phone, email, isDefault } = req.body

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Vendor name is required.' })
  }

  try {
    const existing = await prisma.vendor.findUnique({ where: { name: name.trim() } })
    if (existing) {
      return res.status(409).json({ success: false, error: 'A vendor with that name already exists.' })
    }

    // If setting as default, unset all existing defaults first
    if (isDefault) {
      await prisma.vendor.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    }

    const vendor = await prisma.vendor.create({
      data: {
        name:      name.trim(),
        phone:     phone?.trim()  || null,
        email:     email?.trim()  || null,
        isDefault: Boolean(isDefault),
      },
    })

    return res.status(201).json({ success: true, data: vendor })
  } catch (err) {
    console.error('Create vendor error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// PUT /api/vendors/:id — update vendor
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, phone, email, isActive, isDefault } = req.body

  try {
    const existing = await prisma.vendor.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Vendor not found.' })
    }

    if (name && name.trim() !== existing.name) {
      const dup = await prisma.vendor.findUnique({ where: { name: name.trim() } })
      if (dup) {
        return res.status(409).json({ success: false, error: 'A vendor with that name already exists.' })
      }
    }

    const updateData = {}
    if (name      !== undefined) updateData.name      = name.trim()
    if (phone     !== undefined) updateData.phone     = phone?.trim() || null
    if (email     !== undefined) updateData.email     = email?.trim() || null
    if (isActive  !== undefined) updateData.isActive  = Boolean(isActive)
    if (isDefault !== undefined) updateData.isDefault = Boolean(isDefault)

    // Enforce single default: unset all others before setting this one
    if (isDefault === true) {
      await prisma.vendor.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      })
    }

    const vendor = await prisma.vendor.update({ where: { id }, data: updateData })

    return res.json({ success: true, data: vendor })
  } catch (err) {
    console.error('Update vendor error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/vendors/:id — deactivate vendor (soft delete)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const existing = await prisma.vendor.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Vendor not found.' })
    }

    const vendor = await prisma.vendor.update({
      where: { id },
      data: { isActive: false },
    })

    return res.json({ success: true, data: vendor })
  } catch (err) {
    console.error('Deactivate vendor error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
