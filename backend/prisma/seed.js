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

main().catch(console.error).finally(() => prisma.$disconnect())
