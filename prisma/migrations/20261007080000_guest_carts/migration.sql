-- Guest carts: a cart is owned either by a user or by a guest token (hashed).
-- Additive and non-destructive: existing carts all have user_id set and keep it.

-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "guest_token_hash" CHAR(64),
ALTER COLUMN "user_id" DROP NOT NULL;

-- Exactly one owner per cart.
ALTER TABLE "carts" ADD CONSTRAINT "carts_single_owner_check"
  CHECK (("user_id" IS NULL) <> ("guest_token_hash" IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "carts_guest_token_hash_key" ON "carts"("guest_token_hash");

-- CreateIndex (cleanup of abandoned guest carts by age)
CREATE INDEX "carts_updated_at_idx" ON "carts"("updated_at");
