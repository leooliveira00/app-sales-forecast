-- Adiciona availableUntil ao ForecastRun para controle de fechamento automático
ALTER TABLE "ForecastRun" ADD COLUMN "availableUntil" TIMESTAMP(3);

-- Adiciona novo valor ao enum CycleGate para ciclos aguardando fechamento do ciclo anterior
ALTER TYPE "CycleGate" ADD VALUE IF NOT EXISTS 'AWAITING_PREV_CLOSE';
