-- DropForeignKey
ALTER TABLE "plans" DROP CONSTRAINT "plans_workflowId_fkey";

-- DropIndex
DROP INDEX "plans_workflowId_key";

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "description" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "workflowId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "description" TEXT,
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "plans_userId_deletedAt_idx" ON "plans"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "plans_workflowId_idx" ON "plans"("workflowId");

-- CreateIndex (Partial Unique Index: chỉ enforce 1:1 cho active plans có workflowId)
CREATE UNIQUE INDEX "plans_workflowId_active_unique" ON "plans"("workflowId") WHERE "workflowId" IS NOT NULL AND "deletedAt" IS NULL;

-- CreateIndex
CREATE INDEX "tasks_planId_deletedAt_idx" ON "tasks"("planId", "deletedAt");

-- CreateIndex
CREATE INDEX "tasks_parentTaskId_idx" ON "tasks"("parentTaskId");

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
