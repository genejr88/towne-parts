-- CreateEnum
CREATE TYPE "BMWPaymentStatus" AS ENUM ('NOT_RECEIVED', 'RECEIVED');

-- CreateTable
CREATE TABLE "bmw_payments" (
    "id" SERIAL NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "date" TIMESTAMP(3),
    "lastName" TEXT,
    "bmwNumber" TEXT,
    "roNumber" TEXT,
    "amount" DECIMAL(10,2),
    "status" "BMWPaymentStatus" NOT NULL DEFAULT 'NOT_RECEIVED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bmw_payments_pkey" PRIMARY KEY ("id")
);
