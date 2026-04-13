const express = require('express')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// POST /api/src/ro/:roId — create an SRC entry
router.post('/ro/:roId', requireAuth, async (req, res) => {
  const roId = parseInt(req.params.roId)
  const { entryType, note } = req.body

  if (!entryType) {
    return res.status(400).json({ success: false, error: 'entryType is required (RETURN or CORE_RETURN).' })
  }

  const validTypes = ['RETURN', 'CORE_RETURN']
  if (!validTypes.includes(entryType)) {
    return res.status(400).json({ success: false, error: `Invalid entryType. Must be one of: ${validTypes.join(', ')}.` })
  }

  try {
    const ro = await prisma.rO.findUnique({ where: { id: roId } })
    if (!ro) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    const entry = await prisma.sRCEntry.create({
      data: {
        roId,
        entryType,
        note: note || null,
        createdBy: req.user.username,
        status: 'OPEN',
      },
    })

    await prisma.activityLog.create({
      data: {
        roId,
        eventType: 'SRC_CREATED',
        message: `SRC entry created: ${entryType}${note ? ` — ${note}` : ''} by ${req.user.username}`,
      },
    })

    return res.status(201).json({ success: true, data: entry })
  } catch (err) {
    console.error('Create SRC entry error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// PUT /api/src/:id — update SRC entry (status, note)
router.put('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)
  const { status, note } = req.body

  try {
    const existing = await prisma.sRCEntry.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'SRC entry not found.' })
    }

    const validStatuses = ['OPEN', 'COMPLETED']
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}.` })
    }

    const updateData = {}
    if (note !== undefined) updateData.note = note
    if (status !== undefined) {
      updateData.status = status
      if (status === 'COMPLETED' && existing.status !== 'COMPLETED') {
        updateData.completedAt = new Date()
      } else if (status === 'OPEN') {
        updateData.completedAt = null
      }
    }

    const entry = await prisma.sRCEntry.update({
      where: { id },
      data: updateData,
    })

    if (status && status !== existing.status) {
      await prisma.activityLog.create({
        data: {
          roId: existing.roId,
          eventType: 'SRC_STATUS_CHANGED',
          message: `SRC entry (${existing.entryType}) marked ${status} by ${req.user.username}`,
        },
      })
    }

    return res.json({ success: true, data: entry })
  } catch (err) {
    console.error('Update SRC entry error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/src/:id — delete SRC entry
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const existing = await prisma.sRCEntry.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'SRC entry not found.' })
    }

    await prisma.sRCEntry.delete({ where: { id } })

    await prisma.activityLog.create({
      data: {
        roId: existing.roId,
        eventType: 'SRC_DELETED',
        message: `SRC entry (${existing.entryType}) deleted by ${req.user.username}`,
      },
    })

    return res.json({ success: true, data: { message: 'SRC entry deleted.' } })
  } catch (err) {
    console.error('Delete SRC entry error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
