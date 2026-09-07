/*
  Warnings:

  - A unique constraint covering the columns `[forecastItemId]` on the table `ForecastOverride` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "Perfil" ADD VALUE 'admin_ti';

-- DropForeignKey
ALTER TABLE "ForecastOverride" DROP CONSTRAINT "ForecastOverride_gestorId_fkey";

-- DropIndex
DROP INDEX "ForecastOverride_forecastItemId_gestorId_key";

-- AlterTable
ALTER TABLE "ForecastOverride" ALTER COLUMN "gestorId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ForecastOverrideHistory" (
    "id" TEXT NOT NULL,
    "forecastItemId" TEXT NOT NULL,
    "gestorId" TEXT,
    "volumeFCTS" INTEGER NOT NULL,
    "note" TEXT,
    "revisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastOverrideHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForecastOverrideHistory_forecastItemId_idx" ON "ForecastOverrideHistory"("forecastItemId");

-- CreateIndex
CREATE INDEX "ForecastOverrideHistory_gestorId_idx" ON "ForecastOverrideHistory"("gestorId");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastOverride_forecastItemId_key" ON "ForecastOverride"("forecastItemId");

-- AddForeignKey
ALTER TABLE "ForecastOverride" ADD CONSTRAINT "ForecastOverride_gestorId_fkey" FOREIGN KEY ("gestorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastOverrideHistory" ADD CONSTRAINT "ForecastOverrideHistory_forecastItemId_fkey" FOREIGN KEY ("forecastItemId") REFERENCES "ForecastItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastOverrideHistory" ADD CONSTRAINT "ForecastOverrideHistory_gestorId_fkey" FOREIGN KEY ("gestorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
