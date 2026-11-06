-- AlterEnum
ALTER TYPE "ActivityAction" ADD VALUE 'CATEGORY_90_PERCENT';
ALTER TYPE "ActivityAction" ADD VALUE 'CATEGORY_LIMIT_EXCEEDED';

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLog_dedupeKey_key" ON "ActivityLog"("dedupeKey");
