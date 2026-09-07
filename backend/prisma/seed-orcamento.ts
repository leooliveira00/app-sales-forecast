/**
 * Seed incremental — adiciona OrcamentoRun 2026 + OrcamentoItems
 * Execute: npx tsx prisma/seed-orcamento.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEASONAL = [0.84, 0.89, 0.99, 1.06, 1.12, 1.01, 0.88, 0.94, 1.11, 1.16, 1.09, 0.93];

const d = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));

const rnd = (base: number, idx: number, variance = 0.14) => {
  const pseudo = Math.sin(base + idx * 9301 + 49297) * 0.5 + 0.5;
  return Math.max(1, Math.round(base * (1 + (pseudo - 0.5) * 2 * variance)));
};

async function main() {
  console.log("🌱 Seed incremental: OrcamentoRun 2026...\n");

  let orcRun = await prisma.orcamentoRun.findUnique({ where: { ano: 2026 } });
  if (!orcRun) {
    orcRun = await prisma.orcamentoRun.create({
      data: {
        ano: 2026,
        aprovadoEm: new Date("2025-11-30"),
        status: "APROVADO",
        sourceKey: "ERP-2026-ORC-v1",
      },
    });
    console.log("✔ OrcamentoRun 2026 criado:", orcRun.id);
  } else {
    console.log("ℹ️  OrcamentoRun 2026 já existe:", orcRun.id);
  }

  const produtos = await prisma.produto.findMany({
    include: { unidades: true },
  });

  let count = 0;
  for (const [pIdx, p] of produtos.entries()) {
    for (const pu of p.unidades) {
      for (let month = 1; month <= 12; month++) {
        const seasonal = SEASONAL[month - 1];
        // Usa base=200 como proxy — ORC ≈ budget planejado (independente do forecast run)
        // Na prática este valor viria do ERP/planilha de orçamento
        const forecastItem = await prisma.forecastItem.findFirst({
          where: {
            produtoId: p.id,
            unidadeVendaId: pu.unidadeVendaId,
            month: d(2026, month),
          },
        });

        // ORC do orçamento é próximo ao volumeORC do ForecastItem (±10%)
        const baseORC = forecastItem?.volumeORC ?? Math.round(50 * seasonal);
        const volumeORC = rnd(baseORC, pIdx + month * 200 + 88888, 0.08);

        await prisma.orcamentoItem.upsert({
          where: {
            orcamentoRunId_produtoId_unidadeVendaId_month: {
              orcamentoRunId: orcRun.id,
              produtoId: p.id,
              unidadeVendaId: pu.unidadeVendaId,
              month: d(2026, month),
            },
          },
          create: {
            orcamentoRunId: orcRun.id,
            produtoId: p.id,
            unidadeVendaId: pu.unidadeVendaId,
            month: d(2026, month),
            volumeORC,
          },
          update: {},
        });
        count++;
      }
    }
  }

  console.log(`\n✔ ${count} OrcamentoItems criados/verificados para ${produtos.length} produtos.\n`);
}

main()
  .catch((e) => { console.error("❌ Erro:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
