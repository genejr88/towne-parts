const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// One-time seed: sets up the M#/GF# sequences and backfills the last known
// real BMW number so the counter picks up exactly where the shop left off.
// Safe to re-run — skips any sequence that already exists.
const SEQUENCES = [
  { program: 'BMW',               prefix: 'M',  current: 1129, padLength: 0 },
  { program: 'GENESIS_FAIRFIELD', prefix: 'GF', current: 0,    padLength: 4 },
]

async function main() {
  for (const seq of SEQUENCES) {
    const existing = await prisma.numberSequence.findUnique({ where: { program: seq.program } })
    if (existing) continue
    await prisma.numberSequence.create({ data: seq })
    console.log(`Seeded number sequence: ${seq.program} → next will be ${seq.prefix}${seq.padLength > 0 ? String(seq.current + 1).padStart(seq.padLength, '0') : seq.current + 1}`)
  }

  const bmwHasRecords = await prisma.assignedNumber.findFirst({ where: { program: 'BMW' } })
  if (!bmwHasRecords) {
    await prisma.assignedNumber.create({
      data: {
        program: 'BMW',
        number: 'M1129',
        programRoNumber: '36031649',
        towneRoNumber: '5898',
        vehicleYear: '24',
        vehicleMake: 'BMW',
        vehicleModel: 'i7',
        customerName: 'Kornutik',
      },
    })
    console.log('Seeded last known BMW assigned number: M1129 (Kornutik)')
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
