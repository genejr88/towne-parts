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
  // After data migration from SQLite, PostgreSQL sequences are out of sync with
  // actual max IDs. Use ALTER SEQUENCE RESTART which works regardless of sequence
  // naming conventions (SERIAL vs IDENTITY columns).
  const tables = ['users', 'vendors', 'ros', 'parts', 'part_photos', 'ro_invoices', 'src_entries', 'activity_log']

  for (const table of tables) {
    try {
      // Get current max id
      const rows = await prisma.$queryRawUnsafe(`SELECT COALESCE(MAX(id), 0) AS max_id FROM "${table}"`)
      const maxId = Number(rows[0].max_id)
      const nextVal = maxId + 1

      // Try pg_get_serial_sequence first (SERIAL columns)
      const seqRows = await prisma.$queryRawUnsafe(
        `SELECT pg_get_serial_sequence('"${table}"', 'id') AS seq`
      )
      const seqName = seqRows[0]?.seq

      if (seqName) {
        await prisma.$executeRawUnsafe(`SELECT setval('${seqName}', ${nextVal}, false)`)
        console.log(`[seq] ${table}: set sequence "${seqName}" to ${nextVal} (max id=${maxId})`)
      } else {
        // IDENTITY column — use ALTER SEQUENCE via information_schema lookup
        const identRows = await prisma.$queryRawUnsafe(`
          SELECT s.seqrelid::regclass AS seq_name
          FROM pg_class c
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'id'
          JOIN pg_sequence s ON s.seqrelid = (
            SELECT d.refobjid FROM pg_depend d
            WHERE d.objid = c.oid AND d.refobjsubid = a.attnum
            AND d.classid = 'pg_class'::regclass
            AND d.deptype = 'i'
            LIMIT 1
          )
          WHERE c.relname = '${table}'
        `)
        if (identRows.length > 0) {
          const identSeq = identRows[0].seq_name
          await prisma.$executeRawUnsafe(`ALTER SEQUENCE ${identSeq} RESTART WITH ${nextVal}`)
          console.log(`[seq] ${table}: restarted IDENTITY sequence ${identSeq} at ${nextVal} (max id=${maxId})`)
        } else {
          console.warn(`[seq] ${table}: could not find sequence (max id=${maxId})`)
        }
      }
    } catch (e) {
      console.warn(`[seq] ${table}: error — ${e.message}`)
    }
  }
}

main()
  .then(() => resetSequences())
  .catch(console.error)
  .finally(() => prisma.$disconnect())
