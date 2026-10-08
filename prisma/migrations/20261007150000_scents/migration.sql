-- CreateEnum
CREATE TYPE "ScentType" AS ENUM ('PERFUME', 'NATURAL');

-- CreateTable
CREATE TABLE "scents" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "type" "ScentType" NOT NULL,
    "image_url" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scents_name_key" ON "scents"("name");

-- CreateIndex
CREATE INDEX "scents_is_active_type_idx" ON "scents"("is_active", "type");

