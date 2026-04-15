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
  // Brute-force: restart every known sequence at 10000.
  // All migrated data has IDs well below that, so new inserts will never collide.
  const seqNames = [
    'users_id_seq', 'vendors_id_seq', 'ros_id_seq', 'parts_id_seq',
    'part_photos_id_seq', 'ro_invoices_id_seq', 'src_entries_id_seq', 'activity_log_id_seq',
  ]
  for (const seq of seqNames) {
    try {
      await prisma.$executeRawUnsafe(`ALTER SEQUENCE "${seq}" RESTART WITH 10000`)
      console.log(`[seq] ${seq} → restarted at 10000`)
    } catch (e) {
      console.warn(`[seq] ${seq} not found, trying setval fallback`)
      try {
        await prisma.$executeRawUnsafe(`SELECT setval('${seq}', 10000, false)`)
        console.log(`[seq] ${seq} → setval 10000 ok`)
      } catch (e2) {
        console.warn(`[seq] ${seq} both methods failed: ${e2.message}`)
      }
    }
  }
}

main()
  .then(() => resetSequences())
  .catch(console.error)
  .finally(() => prisma.$disconnect())
