-- DropIndex
DROP INDEX "ActivityLog_budgetId_createdAt_id_idx";

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLog_seq_key" ON "ActivityLog"("seq");

-- CreateIndex
CREATE INDEX "ActivityLog_budgetId_seq_idx" ON "ActivityLog"("budgetId", "seq" DESC);
