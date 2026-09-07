/**
 * Seed incremental — insere SystemConfig e preenche availableFrom nos ForecastRuns.
 * Seguro para executar em banco já populado (usa upsert).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🔧 Seeding SystemConfig e availableFrom...");

  // 1. Configurações globais
  await prisma.systemConfig.upsert({
    where:  { key: "cycleOpenDay"  },
    create: { key: "cycleOpenDay",  value: "5" },
    update: {},
  });
  await prisma.systemConfig.upsert({
    where:  { key: "cycleOpenHour" },
    create: { key: "cycleOpenHour", value: "0" },
    update: {},
  });
  console.log("  ✔ SystemConfig: cycleOpenDay=5, cycleOpenHour=0");

  // 2. Preenche availableFrom nos runs que ainda não têm
  const runs = await prisma.forecastRun.findMany({
    where: { availableFrom: null, status: "SUCCESS" },
    select: { id: true, refMonth: true },
  });

  let updated = 0;
  for (const run of runs) {
    const ref         = run.refMonth;
    const daysInMonth = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0)).getUTCDate();
    const openDay     = Math.min(5, daysInMonth);
    await prisma.forecastRun.update({
      where: { id: run.id },
      data:  { availableFrom: new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), openDay)) },
    });
    updated++;
  }
  console.log(`  ✔ availableFrom preenchido em ${updated} run(s).`);
  console.log("✅ Concluído!");
}

main()
  .catch((e) => { console.error("❌ Erro:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
