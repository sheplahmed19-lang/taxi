-- (See the previous migration's comment: prisma migrate dev's schema-diff
-- engine doesn't know about the hand-written GiST indexes, so the raw diff
-- for this migration also proposed dropping all five. Not applying those.)

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "rejection_reason" TEXT;

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_statements" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "object_key" TEXT NOT NULL,
    "trip_count" INTEGER NOT NULL,
    "total_earnings" INTEGER NOT NULL,
    "total_commission" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_statements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "driver_statements_driver_id_idx" ON "driver_statements"("driver_id");

-- AddForeignKey
ALTER TABLE "driver_statements" ADD CONSTRAINT "driver_statements_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
