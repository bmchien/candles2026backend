-- AlterTable
ALTER TABLE "products" ADD COLUMN     "display_order" INTEGER;

-- CreateIndex
CREATE INDEX "products_display_order_created_at_idx" ON "products"("display_order", "created_at");

