-- CreateTable
CREATE TABLE "tasks" (
    "id" SERIAL NOT NULL,
    "roId" INTEGER NOT NULL,
    "assignedTo" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_assignedTo_idx" ON "tasks"("assignedTo");

-- CreateIndex
CREATE INDEX "tasks_roId_idx" ON "tasks"("roId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_roId_fkey" FOREIGN KEY ("roId") REFERENCES "ros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
