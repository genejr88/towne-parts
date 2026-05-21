// Idempotent — seeds the original hardcoded TECHS list into the Technician
// table on first run. Skips any name that's already in the table.
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const DEFAULTS = ['Stepan', 'Igor', 'Kiril', 'Kosta', 'Eugene', 'Andrii']

async function main() {
  const data = DEFAULTS.map((name, i) => ({ name, sortOrder: i }))
  const result = await prisma.technician.createMany({ data, skipDuplicates: true })
  if (result.count > 0) {
    console.log(`[seed-technicians] seeded ${result.count} technician(s)`)
  }
}

main()
  .catch((err) => console.error('[seed-technicians] failed:', err.message))
  .finally(() => prisma.$disconnect())
