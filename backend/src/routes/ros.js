const express = require('express')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const prisma = require('../lib/prisma')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const fileStore = require('../lib/storage')

const locationDir = path.join(__dirname, '../../uploads/location')
if (!fs.existsSync(locationDir)) fs.mkdirSync(locationDir, { recursive: true })

const locationUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, locationDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg'
      cb(null, `loc-${Date.now()}${ext}`)
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true)
    cb(new Error('Images only'))
  },
})

const router = express.Router()

// Shared include for full RO detail
const RO_DETAIL_INCLUDE = {
  vendor: true,
  parts: {
    include: { photos: true },
    orderBy: { createdAt: 'asc' },
  },
  invoices: { orderBy: { createdAt: 'desc' } },
  locationPhotos: { orderBy: { createdAt: 'asc' } },
  srcEntries: { orderBy: { createdAt: 'desc' } },
  activityLog: { orderBy: { createdAt: 'desc' } },
}

// GET /api/ros
// Query: search, archived (bool string), partsStatus, missingPartsList (bool string)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search, archived, partsStatus, missingPartsList } = req.query

    const where = {}

    // Archived filter — default to non-archived
    if (archived === 'true') {
      where.isArchived = true
    } else {
      where.isArchived = false
    }

    if (partsStatus) {
      where.partsStatus = partsStatus
    }

    // Filter ROs explicitly marked as no parts required
    if (missingPartsList === 'true') {
      where.noPartsRequired = true
    }

    if (search && search.trim()) {
      const s = search.trim()
      where.OR = [
        { roNumber: { contains: s, mode: 'insensitive' } },
        { vehicleMake: { contains: s, mode: 'insensitive' } },
        { vehicleModel: { contains: s, mode: 'insensitive' } },
        { vehicleColor: { contains: s, mode: 'insensitive' } },
        { vin: { contains: s, mode: 'insensitive' } },
        { vendor: { name: { contains: s, mode: 'insensitive' } } },
        { parts: { some: { partNumber: { contains: s, mode: 'insensitive' } } } },
        { parts: { some: { description: { contains: s, mode: 'insensitive' } } } },
      ]
    }

    const ros = await prisma.rO.findMany({
      where,
      include: {
        vendor: true,
        parts: { where: { chaseStatus: { not: 'NOT_NEEDED' } }, select: { id: true, isReceived: true } },
        _count: { select: { parts: true, invoices: true, srcEntries: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    return res.json({ success: true, data: ros })
  } catch (err) {
    console.error('Get ROs error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/ros
router.post('/', requireAuth, async (req, res) => {
  const {
    roNumber,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    vehicleColor,
    vin,
    vendorId,
    ownerName,
    insuranceCompany,
    claimNumber,
    isBmw,
  } = req.body

  if (!roNumber) {
    return res.status(400).json({ success: false, error: 'RO number is required.' })
  }

  try {
    const existing = await prisma.rO.findUnique({ where: { roNumber } })
    if (existing) {
      return res.status(409).json({ success: false, error: 'An RO with that number already exists.' })
    }

    const ro = await prisma.rO.create({
      data: {
        roNumber,
        vehicleYear:      vehicleYear      || null,
        vehicleMake:      vehicleMake      || null,
        vehicleModel:     vehicleModel     || null,
        vehicleColor:     vehicleColor     || null,
        vin:              vin              || null,
        vendorId:         vendorId ? parseInt(vendorId) : null,
        ownerName:        ownerName        || null,
        insuranceCompany: insuranceCompany || null,
        claimNumber:      claimNumber      || null,
        isBmw:            isBmw !== undefined ? Boolean(isBmw) : (vehicleMake?.trim().toLowerCase() === 'bmw'),
      },
      include: { vendor: true },
    })

    // Log activity
    await prisma.activityLog.create({
      data: {
        roId: ro.id,
        eventType: 'RO_CREATED',
        message: `RO ${roNumber} created`,
      },
    })

    return res.status(201).json({ success: true, data: ro })
  } catch (err) {
    console.error('Create RO error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/ros/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const ro = await prisma.rO.findUnique({
      where: { id: parseInt(req.params.id) },
      include: RO_DETAIL_INCLUDE,
    })

    if (!ro) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    return res.json({ success: true, data: ro })
  } catch (err) {
    console.error('Get RO error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// PUT /api/ros/:id
// Fold RO `source` into RO `target` (used when an RO is renumbered to a number that's taken,
// e.g. a parts list imported as 6171 that belongs to 6158). Nothing is thrown away:
//  - every part, parts list / invoice, photo, S.R.C. entry, supplement, task, status update
//    and activity entry moves to the target;
//  - the fields filled in on the edit form overwrite the target's; blank fields keep the
//    target's values; the target keeps its own production stage / board status;
//  - then the emptied source RO is deleted.
// All in one transaction, so it either fully happens or not at all.
async function mergeROInto(source, target, updateData, username) {
  const { roNumber: _ignored, ...fields } = updateData
  const overwrite = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined && v !== ''))
  // isBmw is a checkbox: only carry a "yes" across, never switch the target off
  if (overwrite.isBmw === false) delete overwrite.isBmw
  const moved = {}
  await prisma.$transaction(async (tx) => {
    const by = { where: { roId: source.id }, data: { roId: target.id } }
    // Supplement numbers are unique per RO — renumber the incoming ones after the target's
    const supps = await tx.supplement.findMany({ where: { roId: source.id }, orderBy: { number: 'asc' } })
    if (supps.length) {
      const max = (await tx.supplement.aggregate({ where: { roId: target.id }, _max: { number: true } }))._max.number || 0
      for (let i = 0; i < supps.length; i++) await tx.supplement.update({ where: { id: supps[i].id }, data: { roId: target.id, number: max + i + 1 } })
      moved.supplements = supps.length
    }
    moved.parts = (await tx.part.updateMany(by)).count
    moved.files = (await tx.rOInvoice.updateMany(by)).count
    moved.photos = (await tx.rOLocationPhoto.updateMany(by)).count
    moved.src = (await tx.sRCEntry.updateMany(by)).count
    moved.tasks = (await tx.task.updateMany(by)).count
    await tx.productionStatusUpdate.updateMany(by)
    await tx.activityLog.updateMany(by)
    if (!target.locationPhotoUrl && source.locationPhotoUrl) overwrite.locationPhotoUrl = source.locationPhotoUrl
    await tx.rO.update({ where: { id: target.id }, data: { ...overwrite, isArchived: false, archivedAt: null } })
    await tx.rO.delete({ where: { id: source.id } })
    const summary = Object.entries(moved).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'no attached items'
    await tx.activityLog.create({
      data: { roId: target.id, eventType: 'RO_MERGED', message: `RO ${source.roNumber} merged into ${target.roNumber}${username ? ` by ${username}` : ''} (moved ${summary})` },
    })
  })
  // Parts status depends on the combined parts list
  const parts = await prisma.part.findMany({ where: { roId: target.id }, select: { isReceived: true, chaseStatus: true } })
  if (parts.length) {
    const allHere = parts.every((p) => p.isReceived || p.chaseStatus === 'NOT_NEEDED')
    await prisma.rO.update({ where: { id: target.id }, data: { partsStatus: allHere ? 'ALL_HERE' : 'MISSING' } })
  }
  return prisma.rO.findUnique({ where: { id: target.id }, include: RO_DETAIL_INCLUDE })
}

router.put('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)
  const {
    roNumber,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    vehicleColor,
    vin,
    vendorId,
    partsStatus,
    productionStage,
    productionStatusNote,
    productionWaitingParts,
    productionNextStep,
    productionFinalSupplement,
    productionSupplementNote,
    isBmw,
    noPartsRequired,
    prestorageActive,
    prestorageStartDate,
    isTotalLoss,
    assignedTech,
    // Customer / Owner
    ownerName,
    ownerPhone,
    ownerPhone2,
    ownerEmail,
    // Insurance
    insuranceCompany,
    claimNumber,
    policyNumber,
    adjusterName,
    adjusterPhone,
    deductible,
    dateOfLoss,
  } = req.body

  try {
    const existing = await prisma.rO.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    // Changing to a number another RO already has: tell the app which RO that is, so it can
    // offer to merge. With mergeInto: true, this RO is folded into that one (see below).
    let mergeTarget = null
    if (roNumber && roNumber !== existing.roNumber) {
      const dup = await prisma.rO.findUnique({ where: { roNumber }, include: { _count: { select: { parts: true, invoices: true } } } })
      if (dup && req.body.mergeInto !== true) {
        return res.status(409).json({
          success: false,
          error: `RO ${roNumber} already exists.`,
          existing: {
            id: dup.id, roNumber: dup.roNumber, isArchived: dup.isArchived,
            vehicle: [dup.vehicleYear, dup.vehicleMake, dup.vehicleModel].filter(Boolean).join(' '),
            ownerName: dup.ownerName, parts: dup._count.parts, files: dup._count.invoices,
          },
        })
      }
      mergeTarget = dup
    }

    const updateData = {}
    if (roNumber !== undefined) updateData.roNumber = roNumber
    if (vehicleYear !== undefined) updateData.vehicleYear = vehicleYear
    if (vehicleMake !== undefined) updateData.vehicleMake = vehicleMake
    if (vehicleModel !== undefined) updateData.vehicleModel = vehicleModel
    if (vehicleColor !== undefined) updateData.vehicleColor = vehicleColor
    if (vin !== undefined) updateData.vin = vin
    if (vendorId !== undefined) updateData.vendorId = vendorId ? parseInt(vendorId) : null
    if (partsStatus !== undefined) updateData.partsStatus = partsStatus
    if (productionStage !== undefined) updateData.productionStage = productionStage
    if (productionStatusNote !== undefined) updateData.productionStatusNote = productionStatusNote
    if (productionWaitingParts !== undefined) updateData.productionWaitingParts = productionWaitingParts
    if (productionNextStep !== undefined) updateData.productionNextStep = productionNextStep
    if (productionFinalSupplement !== undefined) updateData.productionFinalSupplement = Boolean(productionFinalSupplement)
    if (productionSupplementNote !== undefined) updateData.productionSupplementNote = productionSupplementNote
    if (isBmw !== undefined) updateData.isBmw = Boolean(isBmw)
    if (noPartsRequired !== undefined) updateData.noPartsRequired = Boolean(noPartsRequired)
    if (prestorageActive !== undefined) updateData.prestorageActive = Boolean(prestorageActive)
    if (prestorageStartDate !== undefined) updateData.prestorageStartDate = prestorageStartDate ? new Date(prestorageStartDate) : null
    if (isTotalLoss !== undefined) updateData.isTotalLoss = Boolean(isTotalLoss)
    if (assignedTech !== undefined) updateData.assignedTech = assignedTech || null

    // Customer / Owner
    if (ownerName       !== undefined) updateData.ownerName       = ownerName       || null
    if (ownerPhone      !== undefined) updateData.ownerPhone      = ownerPhone      || null
    if (ownerPhone2     !== undefined) updateData.ownerPhone2     = ownerPhone2     || null
    if (ownerEmail      !== undefined) updateData.ownerEmail      = ownerEmail      || null

    // Insurance
    if (insuranceCompany !== undefined) updateData.insuranceCompany = insuranceCompany || null
    if (claimNumber      !== undefined) updateData.claimNumber      = claimNumber      || null
    if (policyNumber     !== undefined) updateData.policyNumber     = policyNumber     || null
    if (adjusterName     !== undefined) updateData.adjusterName     = adjusterName     || null
    if (adjusterPhone    !== undefined) updateData.adjusterPhone    = adjusterPhone    || null
    if (deductible       !== undefined) updateData.deductible       = deductible != null && deductible !== '' ? parseFloat(deductible) : null
    if (dateOfLoss       !== undefined) updateData.dateOfLoss       = dateOfLoss ? new Date(dateOfLoss) : null

    if (mergeTarget) {
      const ro = await mergeROInto(existing, mergeTarget, updateData, req.user?.username)
      return res.json({ success: true, data: ro, merged: { from: existing.roNumber, into: mergeTarget.roNumber } })
    }

    const ro = await prisma.rO.update({
      where: { id },
      data: updateData,
      include: RO_DETAIL_INCLUDE,
    })

    return res.json({ success: true, data: ro })
  } catch (err) {
    console.error('Update RO error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/ros/:id — soft delete (archive)
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const existing = await prisma.rO.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    const ro = await prisma.rO.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date() },
    })

    await prisma.activityLog.create({
      data: {
        roId: id,
        eventType: 'RO_ARCHIVED',
        message: `RO ${existing.roNumber} archived`,
      },
    })

    return res.json({ success: true, data: ro })
  } catch (err) {
    console.error('Archive RO error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/ros/:id/unarchive
router.post('/:id/unarchive', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const existing = await prisma.rO.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    const ro = await prisma.rO.update({
      where: { id },
      data: { isArchived: false, archivedAt: null },
    })

    await prisma.activityLog.create({
      data: {
        roId: id,
        eventType: 'RO_UNARCHIVED',
        message: `RO ${existing.roNumber} restored from archive`,
      },
    })

    return res.json({ success: true, data: ro })
  } catch (err) {
    console.error('Unarchive RO error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/ros/:id/location-photos — add a location photo
router.post('/:id/location-photos', requireAuth, locationUpload.single('photo'), async (req, res) => {
  const id = parseInt(req.params.id)
  if (!req.file) return res.status(400).json({ success: false, error: 'No photo uploaded.' })

  try {
    const existing = await prisma.rO.findUnique({ where: { id } })
    if (!existing) {
      await fileStore.discard(req.file)
      return res.status(404).json({ success: false, error: 'RO not found.' })
    }

    await fileStore.save(req.file, 'location')
    const photo = await prisma.rOLocationPhoto.create({
      data: {
        roId: id,
        storedPath: `location/${req.file.filename}`,
        caption: req.body?.caption || null,
      },
    })

    return res.status(201).json({ success: true, data: photo })
  } catch (err) {
    await fileStore.discard(req.file)
    console.error('Location photo upload error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/ros/:id/location-photos/:photoId — delete one location photo
router.delete('/:id/location-photos/:photoId', requireAuth, async (req, res) => {
  const photoId = parseInt(req.params.photoId)
  try {
    const photo = await prisma.rOLocationPhoto.findUnique({ where: { id: photoId } })
    if (!photo) return res.status(404).json({ success: false, error: 'Photo not found.' })

    await fileStore.remove(`location/${path.basename(photo.storedPath)}`)

    await prisma.rOLocationPhoto.delete({ where: { id: photoId } })
    return res.json({ success: true, data: { id: photoId } })
  } catch (err) {
    console.error('Delete location photo error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
