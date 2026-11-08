-- DropIndex
DROP INDEX "ActivityLog_seq_key";

-- DropIndex
DROP INDEX "GoalContribution_goalId_createdAt_idx";

-- CreateIndex
CREATE INDEX "GoalContribution_goalId_createdAt_id_idx" ON "GoalContribution"("goalId", "createdAt" DESC, "id" DESC);

