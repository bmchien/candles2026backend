-- New order workflow + desired receive date.
-- Non-destructive: enum values are RENAMED (existing orders keep their status, now under the
-- new name) and new values are added; no row is deleted or rewritten.
--
--   PENDING    -> AWAITING_DEPOSIT (Chờ cọc)
--   CONFIRMED  -> DEPOSITED        (Đã cọc)
--   PROCESSING -> IN_PRODUCTION    (Đang làm)
--   COMPLETED  -> DELIVERED        (Đã giao: the old final "fulfilled" state)
--   + COMPLETED (Đã hoàn thành: made, ready), + SHIPPING (Đang giao)
--   CANCELLED unchanged

ALTER TYPE "OrderStatus" RENAME VALUE 'PENDING' TO 'AWAITING_DEPOSIT';
ALTER TYPE "OrderStatus" RENAME VALUE 'CONFIRMED' TO 'DEPOSITED';
ALTER TYPE "OrderStatus" RENAME VALUE 'PROCESSING' TO 'IN_PRODUCTION';
ALTER TYPE "OrderStatus" RENAME VALUE 'COMPLETED' TO 'DELIVERED';
ALTER TYPE "OrderStatus" ADD VALUE 'COMPLETED' BEFORE 'DELIVERED';
ALTER TYPE "OrderStatus" ADD VALUE 'SHIPPING' BEFORE 'DELIVERED';

-- The column default follows the renamed value automatically; set it explicitly for clarity.
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'AWAITING_DEPOSIT';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "desired_date" DATE;

-- CreateIndex
CREATE INDEX "orders_desired_date_idx" ON "orders"("desired_date");
