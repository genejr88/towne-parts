const express = require('express')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// GET /api/tasks?status=PENDING
// Returns all tasks with RO info, optionally filtered by status
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status } = req.query
    const where = {}
    if (status) where.status = status

    const tasks = await prisma.task.findMany({
      where,
      include: {
        ro: {
          select: {
            id: true,
            roNumber: true,
            vehicleYear: true,
            vehicleMake: true,
            vehicleModel: true,
            ownerName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return res.json({ success: true, data: tasks })
  } catch (err) {
    console.error('List tasks error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/tasks
// Create a new task { roId, assignedTo, note }
router.post('/', requireAuth, async (req, res) => {
  try {
    const { roId, assignedTo, note } = req.body
    if (!roId || !assignedTo?.trim() || !note?.trim()) {
      return res.status(400).json({ success: false, error: 'roId, assignedTo, and note are required.' })
    }

    const ro = await prisma.rO.findUnique({ where: { id: parseInt(roId) } })
    if (!ro) return res.status(404).json({ success: false, error: 'RO not found.' })

    const task = await prisma.task.create({
      data: {
        roId: parseInt(roId),
        assignedTo: assignedTo.trim(),
        note: note.trim(),
        createdBy: req.user?.username || null,
      },
      include: {
        ro: { select: { id: true, roNumber: true, vehicleYear: true, vehicleMake: true, vehicleModel: true, ownerName: true } },
      },
    })

    return res.json({ success: true, data: task })
  } catch (err) {
    console.error('Create task error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// PUT /api/tasks/:id
// Update a task — mark done, edit note/assignee
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const { status, note, assignedTo } = req.body

    const existing = await prisma.task.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ success: false, error: 'Task not found.' })

    const data = {}
    if (note !== undefined) data.note = note.trim()
    if (assignedTo !== undefined) data.assignedTo = assignedTo.trim()
    if (status !== undefined) {
      data.status = status
      if (status === 'DONE' && existing.status !== 'DONE') {
        data.completedAt = new Date()
        data.completedBy = req.user?.username || null
      }
    }

    const task = await prisma.task.update({
      where: { id },
      data,
      include: {
        ro: { select: { id: true, roNumber: true, vehicleYear: true, vehicleMake: true, vehicleModel: true, ownerName: true } },
      },
    })

    return res.json({ success: true, data: task })
  } catch (err) {
    console.error('Update task error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/tasks/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    await prisma.task.delete({ where: { id } })
    return res.json({ success: true })
  } catch (err) {
    console.error('Delete task error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
