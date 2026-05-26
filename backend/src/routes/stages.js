const express = require('express')
const prisma = require('../lib/prisma')
const { requireAuth, requireAdmin } = require('../middleware/auth')

const router = express.Router()

// Default stages to seed when none exist
const DEFAULT_STAGES = [
  'Unassigned',
  'Teardown',
  'Check-In',
  'Needs Written',
  'Approval',
  'Body',
  'Paint Prep',
  'Paint',
  'Reassembly',
  'Final Supplement',
  'Detail',
  'Delivery',
  'Completed',
]

// GET /api/stages — list active stages (or all with ?all=true)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { all } = req.query
    const where = all === 'true' ? {} : { isActive: true }

    let stages = await prisma.productionStage.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    // Auto-seed defaults if the table is empty (first-time setup)
    if (stages.length === 0) {
      await prisma.productionStage.createMany({
        data: DEFAULT_STAGES.map((name, i) => ({ name, sortOrder: i })),
        skipDuplicates: true,
      })
      stages = await prisma.productionStage.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })
    }

    return res.json({ success: true, data: stages })
  } catch (err) {
    console.error('Get stages error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/stages — create a new stage (admin)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, sortOrder } = req.body

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Stage name is required.' })
  }

  try {
    const existing = await prisma.productionStage.findUnique({ where: { name: name.trim() } })
    if (existing) {
      return res.status(409).json({ success: false, error: 'A stage with that name already exists.' })
    }

    // Default sortOrder to end of list
    let order = typeof sortOrder === 'number' ? sortOrder : null
    if (order === null) {
      const last = await prisma.productionStage.findFirst({ orderBy: { sortOrder: 'desc' } })
      order = last ? last.sortOrder + 10 : 0
    }

    const stage = await prisma.productionStage.create({
      data: { name: name.trim(), sortOrder: order },
    })

    return res.status(201).json({ success: true, data: stage })
  } catch (err) {
    console.error('Create stage error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// PUT /api/stages/:id — update name / order / active (admin)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, sortOrder, isActive } = req.body

  try {
    const existing = await prisma.productionStage.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Stage not found.' })
    }

    if (name && name.trim() !== existing.name) {
      const dup = await prisma.productionStage.findUnique({ where: { name: name.trim() } })
      if (dup) {
        return res.status(409).json({ success: false, error: 'A stage with that name already exists.' })
      }
    }

    const updateData = {}
    if (name      !== undefined) updateData.name      = name.trim()
    if (isActive  !== undefined) updateData.isActive  = Boolean(isActive)
    if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder) || 0

    const stage = await prisma.productionStage.update({ where: { id }, data: updateData })
    return res.json({ success: true, data: stage })
  } catch (err) {
    console.error('Update stage error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/stages/:id — hard delete (admin)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const existing = await prisma.productionStage.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Stage not found.' })
    }

    await prisma.productionStage.delete({ where: { id } })
    return res.json({ success: true })
  } catch (err) {
    console.error('Delete stage error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
