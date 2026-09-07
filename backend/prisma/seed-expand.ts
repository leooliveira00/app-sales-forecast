/**
 * Seed de expansão — Sales Forecast Web
 *
 * Complementa o seed principal adicionando dados históricos e futuros
 * que tornam o gráfico de tendência (últimos 12 meses) significativo.
 *
 * Lê todos os produtos e vínculos de UNIDADE diretamente do banco
 * (DB-driven, sem lista hardcoded).
 *
 * O que cria:
 *  1. OrcamentoRun 2025  + OrcamentoItems para Jan–Dez/2025
 *  2. ForecastRun + ForecastItems para Abr–Dez/2026 (meses futuros ainda sem FCTS)
 *  3. ForecastOverrides (FCTS) para os meses de Jan-Dez/2025 onde existir
 *     VendaMensal — simulando que o gestor revisou o forecast histórico
 *     (útil para o comparativo ORC × FCTS × Vendas no gráfico)
 *  4. VendaMensal para meses de Abr–Dez/2026 que ainda não existam
 *     (projeção de venda futura levemente abaixo do ORC)
 *
 * Execute: npx tsx prisma/seed-expand.ts
 * Flags  : --dry-run   (só mostra o que faria, sem gravar)
 */

import { PrismaClient, RunStatus } from "@prisma/client";

const prisma  = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

// ── Helpers ───────────────────────────────────────────────────────────────────

const d    = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));
const mk   = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

/** Pseudo-aleatório determinístico — reproduzível sem biblioteca externa */
const rnd = (base: number, seed: number, variance = 0.12) => {
  const p = Math.abs(Math.sin(base * 9301 + seed * 49297 + 233) * 0.5 + 0.5);
  return Math.max(1, Math.round(base * (1 + (p - 0.5) * 2 * variance)));
};

/** Fator sazonal por mês 0-based */
const SEASONAL = [0.84, 0.89, 0.99, 1.06, 1.12, 1.01, 0.88, 0.94, 1.11, 1.16, 1.09, 0.93];

/** Crescimento YoY aplicado ao passar de 2025 → 2026 */
const GROWTH_2026 = 1.08;

// ── Leitura do banco ──────────────────────────────────────────────────────────

async function loadProdutosVinculados() {
  /**
   * Retorna todos os vínculos ProdutoUnidadeVenda com a base mensal 2026
   * normalizada (sem sazonalidade).
   *
   * Fonte de volume — prioridade:
   *  1. VendaMensal Jan+Fev/2026 dividido pelo seasonal médio (mais confiável:
   *     seeded diretamente da base real do portfólio)
   *  2. ForecastItem Jan-Mar/2026 (segunda opção)
   *  3. Fallback 100
   *
   * Dividir pelo fator sazonal médio do período dá a base "normalizada"
   * que depois é re-aplicada mês a mês com o seasonal correto.
   */
  const links = await prisma.produtoUnidadeVenda.findMany({
    where: { ativo: true },
    include: { produto: true, unidadeVenda: true },
  });

  // ── 1. VendaMensal Jan+Fev/2026 como base primária ─────────────────────
  // Fator sazonal médio de Jan+Fev = (0.84 + 0.89) / 2 = 0.865
  const AVG_SEASONAL_JAN_FEB = (SEASONAL[0] + SEASONAL[1]) / 2;

  const vendas2026 = await prisma.vendaMensal.findMany({
    where: {
      month: { gte: d(2026, 1), lte: d(2026, 2) },
    },
    select: { produtoId: true, unidadeVendaId: true, quantidade: true },
  });

  const sumVM   = new Map<string, number>();
  const countVM = new Map<string, number>();
  for (const v of vendas2026) {
    const key = `${v.produtoId}|${v.unidadeVendaId}`;
    sumVM.set(key,   (sumVM.get(key)   ?? 0) + v.quantidade);
    countVM.set(key, (countVM.get(key) ?? 0) + 1);
  }
  // base normalizada = média de vendas / fator sazonal médio
  const baseVM = new Map<string, number>();
  for (const [key, total] of sumVM) {
    const mediaVendas = total / (countVM.get(key) ?? 1);
    baseVM.set(key, Math.round(mediaVendas / AVG_SEASONAL_JAN_FEB));
  }

  // ── 2. ForecastItem Jan-Mar/2026 como fallback ──────────────────────────
  const AVG_SEASONAL_JAN_MAR = (SEASONAL[0] + SEASONAL[1] + SEASONAL[2]) / 3;

  const fis = await prisma.forecastItem.findMany({
    where: { month: { gte: d(2026, 1), lte: d(2026, 3) } },
    select: { produtoId: true, unidadeVendaId: true, volumeORC: true },
  });

  const sumFI   = new Map<string, number>();
  const countFI = new Map<string, number>();
  for (const fi of fis) {
    const key = `${fi.produtoId}|${fi.unidadeVendaId}`;
    sumFI.set(key,   (sumFI.get(key)   ?? 0) + (fi.volumeORC ?? 0));
    countFI.set(key, (countFI.get(key) ?? 0) + 1);
  }
  const baseFI = new Map<string, number>();
  for (const [key, total] of sumFI) {
    const media = total / (countFI.get(key) ?? 1);
    baseFI.set(key, Math.round(media / AVG_SEASONAL_JAN_MAR));
  }

  return links.map((lk) => {
    const key = `${lk.produtoId}|${lk.unidadeVendaId}`;
    return {
      produtoId:      lk.produtoId,
      unidadeVendaId: lk.unidadeVendaId,
      produtoCodigo:  lk.produto.codigo,
      unidadeCodigo:  lk.unidadeVenda.codigo,
      // base normalizada (sem seasonal) — re-aplicada mês a mês
      baseMensal2026: baseVM.get(key) ?? baseFI.get(key) ?? 100,
    };
  });
}

// ── Seção 0: Corrigir OrcamentoItems Abr–Dez/2026 ────────────────────────────

async function repairOrcamento2026(
  links: Awaited<ReturnType<typeof loadProdutosVinculados>>
) {
  console.log("\n0/4  Corrigindo OrcamentoItems Abr–Dez/2026 (base real)...");

  const orcRun2026 = await prisma.orcamentoRun.findUnique({ where: { ano: 2026 } });
  if (!orcRun2026) {
    console.log("     ℹ️  OrcamentoRun 2026 não encontrado, pulando.");
    return;
  }

  let count = 0;
  for (const [li, lk] of links.entries()) {
    for (let month = 4; month <= 12; month++) {
      const seasonal  = SEASONAL[month - 1];
      const volumeORC = rnd(Math.round(lk.baseMensal2026 * seasonal), li + month * 200 + 77777);

      if (!DRY_RUN) {
        await prisma.orcamentoItem.upsert({
          where: {
            orcamentoRunId_produtoId_unidadeVendaId_month: {
              orcamentoRunId: orcRun2026.id,
              produtoId:      lk.produtoId,
              unidadeVendaId: lk.unidadeVendaId,
              month:          d(2026, month),
            },
          },
          create: {
            orcamentoRunId: orcRun2026.id,
            produtoId:      lk.produtoId,
            unidadeVendaId: lk.unidadeVendaId,
            month:          d(2026, month),
            volumeORC,
          },
          update: { volumeORC }, // atualiza para o valor correto
        });
      }
      count++;
    }
  }
  console.log(`     ✔ ${count} OrcamentoItems 2026 (Abr-Dez) ${DRY_RUN ? "(dry-run)" : "corrigidos"}`);
}

// ── Seção 1: OrcamentoRun 2025 ────────────────────────────────────────────────

async function seedOrcamento2025(
  links: Awaited<ReturnType<typeof loadProdutosVinculados>>
) {
  console.log("\n1/4  OrcamentoRun 2025 + OrcamentoItems...");

  let run = await prisma.orcamentoRun.findUnique({ where: { ano: 2025 } });
  if (!run) {
    if (!DRY_RUN) {
      run = await prisma.orcamentoRun.create({
        data: {
          ano: 2025,
          aprovadoEm: new Date("2024-11-28"),
          status: "APROVADO",
          sourceKey: "ERP-2025-ORC-v1",
        },
      });
    }
    console.log("     + OrcamentoRun 2025 criado");
  } else {
    console.log("     ℹ️  OrcamentoRun 2025 já existe");
  }

  let count = 0;
  for (const [li, lk] of links.entries()) {
    // Base 2025 = base 2026 / crescimento YoY
    const base2025 = Math.round(lk.baseMensal2026 / GROWTH_2026);

    for (let month = 1; month <= 12; month++) {
      const seasonal  = SEASONAL[month - 1];
      const volumeORC = rnd(Math.round(base2025 * seasonal), li + month * 317 + 11111);

      if (!DRY_RUN && run) {
        await prisma.orcamentoItem.upsert({
          where: {
            orcamentoRunId_produtoId_unidadeVendaId_month: {
              orcamentoRunId: run.id,
              produtoId:      lk.produtoId,
              unidadeVendaId: lk.unidadeVendaId,
              month:          d(2025, month),
            },
          },
          create: {
            orcamentoRunId: run.id,
            produtoId:      lk.produtoId,
            unidadeVendaId: lk.unidadeVendaId,
            month:          d(2025, month),
            volumeORC,
          },
          update: { volumeORC }, // força atualização com base correta
        });
      }
      count++;
    }
  }
  console.log(`     ✔ ${count} OrcamentoItems 2025 ${DRY_RUN ? "(dry-run)" : "atualizados"}`);
}

// ── Seção 2: ForecastRuns Abr–Dez/2026 ───────────────────────────────────────

async function seedForecastRuns2026(
  links: Awaited<ReturnType<typeof loadProdutosVinculados>>
) {
  console.log("\n2/4  ForecastRuns + ForecastItems Abr–Dez/2026...");

  const FUTURE_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12]; // Abr-Dez
  let runCount  = 0;
  let itemCount = 0;

  for (const [mi, month] of FUTURE_MONTHS.entries()) {
    let run = await prisma.forecastRun.findFirst({
      where: { refMonth: d(2026, month), status: "SUCCESS" },
    });

    if (!run) {
      if (!DRY_RUN) {
        run = await prisma.forecastRun.create({
          data: {
            refMonth:   d(2026, month),
            executedAt: d(2026, month),
            status:     "SUCCESS" as RunStatus,
            sourceKey:  `airflow-2026-${String(month).padStart(2, "0")}`,
          },
        });
      }
      runCount++;
    }

    for (const [li, lk] of links.entries()) {
      const seasonal  = SEASONAL[month - 1];
      const volumeORC = rnd(Math.round(lk.baseMensal2026 * seasonal), li + month * 500 + 22222);
      const volumeIA  = rnd(Math.round(lk.baseMensal2026 * seasonal), li + month * 500 + 33333, 0.10);
      const estoque   = rnd(Math.round(lk.baseMensal2026 * 2),        li + month * 500 + 44444);

      if (!DRY_RUN && run) {
        await prisma.forecastItem.upsert({
          where: {
            runId_produtoId_unidadeVendaId_month_paisIso3: {
              runId:          run.id,
              produtoId:      lk.produtoId,
              unidadeVendaId: lk.unidadeVendaId,
              month:          d(2026, month),
              paisIso3:       null,
            },
          },
          create: {
            runId:          run.id,
            produtoId:      lk.produtoId,
            unidadeVendaId: lk.unidadeVendaId,
            month:          d(2026, month),
            volumeIA,
            paisIso3:       null,
            estoque,
          },
          update: {},
        });
      }
      itemCount++;
    }
  }

  console.log(`     ✔ ${runCount} ForecastRuns + ${itemCount} ForecastItems 2026 ${DRY_RUN ? "(dry-run)" : "criados/verificados"}`);
}

// ── Seção 3: VendaMensal Abr–Dez/2026 (projeção) ─────────────────────────────

async function seedVendas2026(
  links: Awaited<ReturnType<typeof loadProdutosVinculados>>
) {
  console.log("\n3/4  VendaMensal Abr–Dez/2026 (projeção futura)...");

  const FUTURE_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12];
  let count = 0;

  for (const [li, lk] of links.entries()) {
    for (const [mi, month] of FUTURE_MONTHS.entries()) {
      const seasonal   = SEASONAL[month - 1];
      // Venda projetada ≈ 92–102% do ORC
      const quantidade = rnd(Math.round(lk.baseMensal2026 * seasonal), li + month * 700 + 55555, 0.08);

      if (!DRY_RUN) {
        await prisma.vendaMensal.upsert({
          where: {
            produtoId_unidadeVendaId_month_canal: {
              produtoId:      lk.produtoId,
              unidadeVendaId: lk.unidadeVendaId,
              month:          d(2026, month),
              canal:          "VENDA DIRETA",
            },
          },
          create: {
            produtoId:      lk.produtoId,
            unidadeVendaId: lk.unidadeVendaId,
            month:          d(2026, month),
            quantidade,
            canal:          "VENDA DIRETA",
          },
          update: {},
        });
      }
      count++;
    }
  }

  console.log(`     ✔ ${count} VendaMensal 2026 ${DRY_RUN ? "(dry-run)" : "criados/verificados"}`);
}

// ── Seção 4: ForecastOverrides 2025 (FCTS histórico para gestores ativos) ─────

async function seedOverrides2025(
  links: Awaited<ReturnType<typeof loadProdutosVinculados>>
) {
  console.log("\n4/4  ForecastOverrides históricos 2025 (FCTS)...");
  /**
   * Para termos FCTS nos meses de 2025, precisamos de:
   *  ForecastRun 2025 + ForecastItems + ForecastOverrides
   *
   * Como o Airflow não rodou em 2025 (dados históricos ficticios),
   * criamos runs retroativos para os gestores que têm unidades ativas.
   */

  // Busca os gestores e seus vínculos de unidade
  const gestores = await prisma.user.findMany({
    where:   { perfil: "gestor" },
    include: { unidades: { where: { ativo: true }, include: { unidadeVenda: true } } },
  });

  let runCount  = 0;
  let itemCount = 0;
  let orCount   = 0;

  for (let month = 1; month <= 12; month++) {
    let run = await prisma.forecastRun.findFirst({
      where: { refMonth: d(2025, month), status: "SUCCESS" },
    });

    if (!run) {
      if (!DRY_RUN) {
        run = await prisma.forecastRun.create({
          data: {
            refMonth:   d(2025, month),
            executedAt: d(2025, month),
            status:     "SUCCESS" as RunStatus,
            sourceKey:  `airflow-2025-${String(month).padStart(2, "0")}`,
          },
        });
      }
      runCount++;
    }

    // ForecastItems + Overrides para cada produto/unidade do mês
    for (const [li, lk] of links.entries()) {
      const seasonal   = SEASONAL[month - 1];
      const base2025   = Math.round(lk.baseMensal2026 / GROWTH_2026);
      const volumeORC  = rnd(Math.round(base2025 * seasonal), li + month * 317 + 11111); // = OrcamentoItem 2025
      const volumeIA   = rnd(Math.round(base2025 * seasonal), li + month * 317 + 66666, 0.10);
      const volumeFCTS = rnd(Math.round(base2025 * seasonal), li + month * 317 + 77777, 0.08);

      let item = !DRY_RUN && run
        ? await prisma.forecastItem.upsert({
            where: {
              runId_produtoId_unidadeVendaId_month_paisIso3: {
                runId:          run.id,
                produtoId:      lk.produtoId,
                unidadeVendaId: lk.unidadeVendaId,
                month:          d(2025, month),
                paisIso3:       null,
              },
            },
            create: {
              runId:          run.id,
              produtoId:      lk.produtoId,
              unidadeVendaId: lk.unidadeVendaId,
              month:          d(2025, month),
              volumeIA,
              paisIso3:       null,
            },
            update: { volumeIA }, // recalcula com base correta
          })
        : null;
      itemCount++;

      // Encontra o gestor da unidade para criar o override
      const gestor = gestores.find(g =>
        g.unidades.some(u => u.unidadeVendaId === lk.unidadeVendaId)
      );

      if (gestor && item && !DRY_RUN) {
        await prisma.forecastOverride.upsert({
          where: {
            forecastItemId_gestorId: {
              forecastItemId: item.id,
              gestorId:       gestor.id,
            },
          },
          create: {
            forecastItemId: item.id,
            gestorId:       gestor.id,
            volumeFCTS,
          },
          update: { volumeFCTS }, // recalcula com base correta
        });
        orCount++;
      }
    }
  }

  console.log(`     ✔ ${runCount} ForecastRuns 2025 + ${itemCount} Items + ${orCount} Overrides ${DRY_RUN ? "(dry-run)" : "atualizados"}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) {
    console.log("\n⚠️  MODO DRY-RUN — nenhuma gravação será feita.\n");
  }

  console.log("🌱 Seed de expansão — lendo produtos do banco...");
  const links = await loadProdutosVinculados();
  console.log(`   ${links.length} vínculos produto×unidade encontrados.`);

  await repairOrcamento2026(links);
  await seedOrcamento2025(links);
  await seedForecastRuns2026(links);
  await seedVendas2026(links);
  await seedOverrides2025(links);

  const totals = {
    "OrcamentoItems 2026 (corrigidos)": links.length * 9,
    "OrcamentoItems 2025":        links.length * 12,
    "ForecastRuns 2026 (Abr-Dez)": 9,
    "ForecastItems 2026 (Abr-Dez)":links.length * 9,
    "VendaMensal 2026 (Abr-Dez)":  links.length * 9,
    "ForecastRuns 2025":           12,
    "ForecastItems 2025":          links.length * 12,
    "Overrides (FCTS) 2025":       links.length * 12,
  };

  console.log(`
╔═══════════════════════════════════════════════════╗
║     Seed de expansão concluído${DRY_RUN ? " (DRY-RUN)" : ""}         ║
╠═══════════════════════════════════════════════════╣`);
  for (const [label, qtd] of Object.entries(totals)) {
    console.log(`║  ${label.padEnd(33)}: ${String(qtd).padEnd(5)} ║`);
  }
  console.log("╚═══════════════════════════════════════════════════╝");
}

main()
  .catch((e) => { console.error("❌ Erro:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
