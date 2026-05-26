// Idempotent bootstrap — inserts ROs visible in the current CCC ONE workflow
// snapshot. Re-runs on every deploy but skips any roNumber that already exists.
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Map CCC-style stage labels → towne-parts STAGES
const STAGE_MAP = {
  '01 teardown':   'Teardown',
  '04 body':       'Body',
  '06 paint':      'Paint',
  '06 prep':       'Paint Prep',
  '08 reassemble': 'Reassembly',
  '08 reasse':     'Reassembly',
  '09 detail':     'Detail',
  '15 total loss': 'Unassigned',
  '15 total lo':   'Unassigned',
  'hbm':           'Body',          // HBM is a flag now — keep production stage moving
  '2nd ins app':   'Approval',
  '2nd ins ap':    'Approval',
  'write estim':   'Needs Written',
  'write estimate':'Needs Written',
  '[completed]':   'Completed',
  'completed':     'Completed',
}

// Make abbreviations → full make names
const MAKE_MAP = {
  SUBA: 'Subaru',
  HYUN: 'Hyundai',
  TOYO: 'Toyota',
  BENZ: 'Mercedes-Benz',
  VW:   'Volkswagen',
  BMW:  'BMW',
  CHEV: 'Chevrolet',
  RAM:  'RAM',
  JEEP: 'Jeep',
  LEXU: 'Lexus',
  MAZD: 'Mazda',
  JAGU: 'Jaguar',
  HOND: 'Honda',
  GENE: 'Genesis',
  AUDI: 'Audi',
}

// Raw RO snapshot from CCC ONE workflow
// [roNumber, owner, year, makeAbbr, model, ccc-stage]
const ROS = [
  // Screenshot 2 (lower RO numbers, run first to preserve creation order roughly)
  ['5634', 'Gorham, Ricky',          '2019', 'BMW',  'X5 xDrive40i',   '06 Paint'],
  ['5635', 'm1093 RO 360',           '2024', 'BMW',  'X3 xDrive',      '06 Paint'],
  ['5640', 'Dellabianca, Ni',        '2024', 'VW',   'Tiguan SE R',    '09 Detail'],
  ['5642', 'm1093 RO 360',           '2021', 'BMW',  'X5 xDrive',      '04 Body'],
  ['5643', 'Young, Floyd',           '2022', 'CHEV', 'Colorado',       '06 Paint'],
  ['5646', 'Velez, CAPT Luis',       '2023', 'JEEP', 'Gladiator',      '08 Reasse'],
  ['5647', 'Deutsch, Adam',          '2024', 'HYUN', 'Palisade',       '[Completed]'],
  ['5648', 'Gedarovich, Ja',         '2023', 'SUBA', 'Ascent Touring', '06 Paint'],
  ['5649', 'Wilson, Gregory',        '2021', 'TOYO', 'Sienna XLE',     'HBM'],
  ['5650', 'Cordova, Jorge',         '2019', 'RAM',  'ProMaster',      '04 Body'],
  ['5652', 'Adrovic, Emil',          '2021', 'BENZ', 'Sprinter Cargo', '15 Total Lo'],
  ['5653', 'PERRY, WALKY',           '2018', 'CHEV', 'Impala Premier', '04 Body'],
  ['5656', 'Terrile, LTCOL',         '2019', 'LEXU', 'RX 350 AWD',     '06 Prep'],
  ['5657', 'Clare, Daniel',          '2021', 'SUBA', 'Outback Limited','08 Reasse'],
  ['5659', 'WHALEN, PAT',            '2024', 'MAZD', 'CX-90 PHEV',     '06 Paint'],
  ['5660', 'Scali, George',          '2019', 'SUBA', 'Crosstrek',      '2nd Ins Ap'],
  ['5662', 'Flynn, Andrew',          '2020', 'JAGU', 'F-PACE Premium', '04 Body'],
  ['5663', 'Sauer, Craig',           '2026', 'BMW',  'X3 30 xDrive',   '2nd Ins Ap'],
  ['5664', 'm1095 RO 360',           '2021', 'BMW',  'X4 M40i',        '04 Body'],
  ['5665', 'Miller, Sandra',         '2025', 'HOND', 'Accord Hybrid',  '06 Paint'],
  ['5666', 'Thorpe, SPC Ki',         '2018', 'TOYO', 'RAV4 SE',        '04 Body'],
  ['5667', 'Oatman, SPC',            '2026', 'HOND', 'HR-V Sport',     'HBM'],
  ['5668', 'Kearney, Aaron',         '2009', 'CHEV', 'Impala LT',      '15 Total Lo'],
  ['5670', 'Lewis, Racine',          '2022', 'GENE', 'G70 AWD',        '2nd Ins Ap'],

  // Screenshot 1
  ['5672', 'Uddin, MD',              '2021', 'SUBA', 'Crosstrek',      '06 Paint'],
  ['5673', 'MAYERS-OSO',             '2018', 'BMW',  'X3 M40i',        '04 Body'],
  ['5674', 'MIDDLEBROO',             '2016', 'HYUN', 'Veloster',       '2nd Ins Ap'],
  ['5676', 'Luniaka, Oleksii',       '2024', 'TOYO', 'Camry SE',       'Write Estim'],
  ['5677', 'BOATWRIGHT',             '2019', 'TOYO', 'Camry XSE',      '04 Body'],
  ['5680', 'RADER, LORA',            '2026', 'VW',   'Tiguan SE',      '06 Paint'],
  ['5682', 'FELICITA-CHA',           '2024', 'BMW',  'XM Sports',      'Write Estim'],
  ['5683', 'Antipov, Vitality',      '2024', 'BENZ', 'Sprinter Cargo', '04 Body'],
  ['5684', 'BEQIRI, TRIM',           '2022', 'HYUN', 'Ioniq 5',        '01 Teardown'],
  ['5686', 'm1097 RO 360',           '2024', 'BMW',  'X4 xDrive30i',   'Write Estim'],
  ['5688', 'GONZALEZ, B',            '2021', 'BMW',  'X3 M Sport',     'Write Estim'],
  ['5689', 'Ruiz, Noel',             '2018', 'HYUN', 'Sonata SE',      '2nd Ins Ap'],
  ['5690', 'Kret, Radoslaw',         '2023', 'GENE', 'GV70 AWD',       '2nd Ins Ap'],
  ['5692', 'Leblanc, stepha',        '2020', 'AUDI', 'A3 Sedan',       'Write Estim'],
  ['5693', 'PIROZZOLI, D',           '2026', 'SUBA', 'Forester P',     'Write Estim'],
  ['5695', 'm1098 RO 360',           '2022', 'BMW',  'X3 xDrive30i',   'Write Estim'],
  ['5696', 'm1099 RO 360',           '2021', 'BMW',  '3 Series 330i',  'Write Estim'],
]

function mapStage(ccc) {
  return STAGE_MAP[String(ccc || '').trim().toLowerCase()] || 'Unassigned'
}

function mapMake(abbr) {
  return MAKE_MAP[abbr] || abbr
}

async function main() {
  const existing = await prisma.rO.findMany({
    where: { roNumber: { in: ROS.map((r) => r[0]) } },
    select: { roNumber: true },
  })
  const have = new Set(existing.map((e) => e.roNumber))

  const toCreate = ROS.filter((r) => !have.has(r[0]))
  if (toCreate.length === 0) {
    console.log('[bootstrap-ros] all ROs already present — skipping')
    return
  }

  const data = toCreate.map(([roNumber, owner, year, makeAbbr, model, cccStage]) => {
    const stageLabel = String(cccStage).trim().toLowerCase()
    const make = mapMake(makeAbbr)
    return {
      roNumber,
      ownerName: owner || null,
      vehicleYear: year || null,
      vehicleMake: make || null,
      vehicleModel: model || null,
      productionStage: mapStage(stageLabel),
      isBmw:       make === 'BMW',
      isHBM:       stageLabel === 'hbm',
      isTotalLoss: stageLabel.startsWith('15 total') || stageLabel.includes('total loss'),
    }
  })

  // createMany handles bulk insert; unique constraint on roNumber gives belt-and-suspenders
  const result = await prisma.rO.createMany({ data, skipDuplicates: true })
  console.log(`[bootstrap-ros] inserted ${result.count} new RO(s)`)
}

main()
  .catch((err) => {
    // Non-fatal — never block server startup
    console.error('[bootstrap-ros] failed:', err.message)
  })
  .finally(() => prisma.$disconnect())
