const express = require('express')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

/**
 * Recompute partsStatus for an RO based on all its parts.
 * - No parts or any non-received → MISSING
 * - All received → ALL_HERE
 * Called after any part received status change.
 */
async function syncROPartsStatus(roId) {
  const parts = await prisma.part.findMany({
    where: { roId },
    select: { isReceived: true },
  })

  if (parts.length === 0) return

  const allReceived = parts.every((p) => p.isReceived)

  const newStatus = allReceived ? 'ALL_HERE' : 'MISSING'

  await prisma.rO.update({
    where: { id: roId },
    data: { partsStatus: newStatus },
  })
}

// POST /api/parts/ro/:roId — add a part to an RO
router.post('/ro/:roId', requireAuth, async (req, res) => {
  const roId = parseInt(req.params.roId)
  const {
    qty,
    partNumber,
    description,
    dateOrdered,
    etaDate,
    finishStatus,
    isReceived,
    hasCore,
    price,
  } = req.body

  try {
    const ro = await prisma.rO.findUnique({ where: { id: roId } })
    if (!ro) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    const part = await prisma.part.create({
      data: {
        roId,
        qty: qty ? parseInt(qty) : 1,
        partNumber: partNumber || null,
        description: description || null,
        dateOrdered: dateOrdered ? new Date(dateOrdered) : null,
        etaDate: etaDate ? new Date(etaDate) : null,
        finishStatus: finishStatus || 'NO_FINISH_NEEDED',
        isReceived: Boolean(isReceived),
        hasCore: Boolean(hasCore),
        receivedAt: isReceived ? new Date() : null,
        price: price != null ? price : null,
      },
      include: { photos: true },
    })

    // If the part was created already received, sync RO status
    if (part.isReceived) {
      await syncROPartsStatus(roId)
    } else {
      // Any non-received part means MISSING
      await prisma.rO.update({
        where: { id: roId },
        data: { partsStatus: 'MISSING' },
      })
    }

    await prisma.activityLog.create({
      data: {
        roId,
        eventType: 'PART_ADDED',
        message: `Part added: ${description || partNumber || 'Unnamed'}`,
      },
    })

    return res.status(201).json({ success: true, data: part })
  } catch (err) {
    console.error('Add part error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// PUT /api/parts/:id — update a part
router.put('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)
  const {
    qty,
    partNumber,
    description,
    dateOrdered,
    etaDate,
    finishStatus,
    isReceived,
    hasCore,
    price,
  } = req.body

  try {
    const existing = await prisma.part.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Part not found.' })
    }

    const updateData = {}
    if (qty !== undefined) updateData.qty = parseInt(qty)
    if (partNumber !== undefined) updateData.partNumber = partNumber
    if (description !== undefined) updateData.description = description
    if (dateOrdered !== undefined) updateData.dateOrdered = dateOrdered ? new Date(dateOrdered) : null
    if (etaDate !== undefined) updateData.etaDate = etaDate ? new Date(etaDate) : null
    if (finishStatus !== undefined) updateData.finishStatus = finishStatus
    if (hasCore !== undefined) updateData.hasCore = Boolean(hasCore)
    if (price !== undefined) updateData.price = price != null ? price : null

    // Handle received status change
    if (isReceived !== undefined) {
      const nowReceived = Boolean(isReceived)
      updateData.isReceived = nowReceived
      if (nowReceived && !existing.isReceived) {
        updateData.receivedAt = new Date()
      } else if (!nowReceived) {
        updateData.receivedAt = null
      }
    }

    const part = await prisma.part.update({
      where: { id },
      data: updateData,
      include: { photos: true },
    })

    // Sync RO partsStatus when received flag changed
    if (isReceived !== undefined) {
      await syncROPartsStatus(existing.roId)

      const statusLabel = part.isReceived ? 'received' : 'marked not received'
      await prisma.activityLog.create({
        data: {
          roId: existing.roId,
          eventType: 'PART_STATUS_CHANGED',
          message: `Part "${existing.description || existing.partNumber || id}" ${statusLabel}`,
        },
      })
    }

    return res.json({ success: true, data: part })
  } catch (err) {
    console.error('Update part error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/parts/:id — delete a part
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const existing = await prisma.part.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Part not found.' })
    }

    await prisma.part.delete({ where: { id } })

    // Re-sync RO parts status after deletion
    await syncROPartsStatus(existing.roId)

    await prisma.activityLog.create({
      data: {
        roId: existing.roId,
        eventType: 'PART_DELETED',
        message: `Part deleted: ${existing.description || existing.partNumber || id}`,
      },
    })

    return res.json({ success: true, data: { message: 'Part deleted.' } })
  } catch (err) {
    console.error('Delete part error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
