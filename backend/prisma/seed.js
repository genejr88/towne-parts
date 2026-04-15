const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

async function main() {
  // Admin user — clear username from other users first to avoid unique constraint clash
  await prisma.user.updateMany({
    where: { username: 'gene', NOT: { id: -1 } },
    data: {},
  })

  const existing = await prisma.user.findUnique({ where: { username: 'gene' } })
  if (existing) {
    await prisma.user.update({
      where: { username: 'gene' },
      data: {
        password: await bcrypt.hash('TowneParts1', 10),
        role: 'ADMIN',
      },
    })
    console.log('Admin user updated')
  } else {
    await prisma.user.create({
      data: {
        username: 'gene',
        password: await bcrypt.hash('TowneParts1', 10),
        role: 'ADMIN',
      },
    })
    console.log('Admin user created')
  }

  // Standard shared admin account
  await prisma.user.upsert({
    where: { username: 'Admin' },
    update: { password: await bcrypt.hash('Towne123!', 10), role: 'ADMIN' },
    create: { username: 'Admin', password: await bcrypt.hash('Towne123!', 10), role: 'ADMIN' },
  })
  console.log('Shared admin account ready: Admin')

  // Alissa
  await prisma.user.upsert({
    where: { username: 'alissa' },
    update: {},
    create: { username: 'alissa', password: await bcrypt.hash('Towne123!', 10), role: 'ADMIN' },
  })
  console.log('User ready: alissa')

  // Default vendors
  const vendors = ['ActiveParts', 'BMW', 'Ford', 'GM', 'Mopar', 'Toyota', 'Other']
  for (const name of vendors) {
    await prisma.vendor.upsert({
      where: { name },
      update: {},
      create: { name },
    })
  }
  console.log('Vendors seeded')
}

async function resetSequences() {
  // Set each sequence to MAX(current max id, 10000) + 1 so it never conflicts
  // with existing rows, whether from migration or normal use.
  const tables = [
    { seq: 'users_id_seq',       table: '"User"' },
    { seq: 'vendors_id_seq',     table: '"Vendor"' },
    { seq: 'ros_id_seq',         table: '"RO"' },
    { seq: 'parts_id_seq',       table: '"Part"' },
    { seq: 'part_photos_id_seq', table: '"PartPhoto"' },
    { seq: 'ro_invoices_id_seq', table: '"ROInvoice"' },
    { seq: 'src_entries_id_seq', table: '"SRCEntry"' },
    { seq: 'activity_log_id_seq',table: '"ActivityLog"' },
  ]
  for (const { seq, table } of tables) {
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT COALESCE(MAX(id), 0) AS m FROM ${table}`)
      const maxId = Number(rows[0].m)
      const next = Math.max(maxId + 1, 10000)
      await prisma.$executeRawUnsafe(`SELECT setval('${seq}', ${next}, false)`)
      console.log(`[seq] ${seq} → ${next} (max id was ${maxId})`)
    } catch (e) {
      console.warn(`[seq] ${seq} skipped: ${e.message}`)
    }
  }
}

main()
  .then(() => resetSequences())
  .catch(console.error)
  .finally(() => prisma.$disconnect())
