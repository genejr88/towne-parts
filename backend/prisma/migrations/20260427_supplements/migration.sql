-- CreateEnum
CREATE TYPE "SupplementStatus" AS ENUM ('REQUESTED', 'FILED');

-- CreateTable
CREATE TABLE "supplements" (
    "id" SERIAL NOT NULL,
    "roId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "SupplementStatus" NOT NULL DEFAULT 'REQUESTED',
    "insuranceCompany" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplements_roId_number_key" ON "supplements"("roId", "number");

-- AddForeignKey
ALTER TABLE "supplements" ADD CONSTRAINT "supplements_roId_fkey" FOREIGN KEY ("roId") REFERENCES "ros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
