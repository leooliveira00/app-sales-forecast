/**
 * Realinha o fechamento dos ciclos AINDA ABERTOS para o fim do dia no fuso de
 * negócio (23:59:59 de Brasília), corrigindo os runs gravados antes da adoção do
 * helper `endOfBusinessDay` — que os deixava fechando às 20:59:59 BRT.
 *
 * Seguro por construção:
 *  - só toca runs com `availableUntil` no futuro (ciclos abertos). Ciclos já
 *    encerrados preservam o instante real do fechamento;
 *  - ignora runs sem `availableUntil` e o sentinel de bloqueio (>= 9000-01-01);
 *  - idempotente: rodar de novo não muda nada.
 *
 * Uso:
 *   docker exec <backend> npx tsx src/scripts/fix-cycle-close-timezone.ts [--dry]
 */
import "dotenv/config";
import prisma from "../config/prisma.js";
import { getCycleCloseDay } from "../services/system-config.service.js";
import { endOfBusinessDay } from "../utils/business-time.js";

const dryRun = process.argv.includes("--dry");
const SENTINEL_FLOOR = new Date("9000-01-01");

const cycleCloseDay = await getCycleCloseDay();
const now = new Date();

const runs = await prisma.forecastRun.findMany({
  where:  { availableUntil: { gt: now, lt: SENTINEL_FLOOR } },
  select: { id: true, refMonth: true, availableUntil: true },
  orderBy: { refMonth: "asc" },
});

console.log(`cycleCloseDay=${cycleCloseDay} · ${runs.length} run(s) com janela aberta\n`);

let updated = 0;
for (const run of runs) {
  const ref         = run.refMonth;
  const daysInMonth = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0)).getUTCDate();
  const closeDay    = Math.min(cycleCloseDay, daysInMonth);
  const expected    = endOfBusinessDay(ref.getUTCFullYear(), ref.getUTCMonth(), closeDay);

  const current = run.availableUntil as Date;
  if (current.getTime() === expected.getTime()) {
    console.log(`  =  ${ref.toISOString().substring(0, 7)} já correto (${current.toISOString()})`);
    continue;
  }

  console.log(`  →  ${ref.toISOString().substring(0, 7)}: ${current.toISOString()} → ${expected.toISOString()}`);
  if (!dryRun) {
    await prisma.forecastRun.update({ where: { id: run.id }, data: { availableUntil: expected } });
  }
  updated++;
}

console.log(`\n${dryRun ? "[dry-run] " : ""}${updated} run(s) ${dryRun ? "seriam ajustados" : "ajustados"}.`);
process.exit(0);
