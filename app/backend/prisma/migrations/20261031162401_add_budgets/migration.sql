-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'EDITOR', 'LIMITED_EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('EUR', 'USD', 'JPY', 'CNY', 'INR', 'GBP');

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'LIMITED_EDITOR',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneTimeInvite" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'LIMITED_EDITOR',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OneTimeInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetMember_budgetId_idx" ON "BudgetMember"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetMember_userId_budgetId_key" ON "BudgetMember"("userId", "budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "OneTimeInvite_token_key" ON "OneTimeInvite"("token");

-- CreateIndex
CREATE INDEX "OneTimeInvite_budgetId_idx" ON "OneTimeInvite"("budgetId");

-- CreateIndex
CREATE INDEX "OneTimeInvite_createdById_idx" ON "OneTimeInvite"("createdById");

-- AddForeignKey
ALTER TABLE "BudgetMember" ADD CONSTRAINT "BudgetMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetMember" ADD CONSTRAINT "BudgetMember_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneTimeInvite" ADD CONSTRAINT "OneTimeInvite_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneTimeInvite" ADD CONSTRAINT "OneTimeInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
