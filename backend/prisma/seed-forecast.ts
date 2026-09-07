/**
 * seed-forecast.ts
 *
 * Carga incremental exclusiva de dados de Forecast a partir de CSV.
 * NÃO apaga dados existentes — usa upsert em todas as operações.
 *
 * Pré-requisitos:
 *   - Produto, UnidadeVenda e ProdutoUnidadeVenda já existem no banco
 *   - OrcamentoItem já existe (necessário para calcular Desvios Críticos no dashboard)
 *   - Pelo menos um usuário com perfil "gestor" ou "admin" cadastrado
 *     (será usado como autor dos ForecastOverrides)
 *
 * Execução:
 *   cd backend
 *   npm run seed:forecast
 *
 * Arquivo esperado:
 *   backend/prisma/data/ForecastItem.csv
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, "data");
const prisma    = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────────────────────

function parseCsv(filename: string): Record<string, string>[] {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.trim().split("\n");

  if (lines.length < 2) {
    console.warn(`  [aviso] ${filename} está vazio ou sem linhas de dados.`);
    return [];
  }

  const headers = lines[0].split(";").map((h) => h.trim());
  return lines.slice(1).map((line, idx) => {
    const values = line.split(";").map((v) => v.trim());
    if (values.length !== headers.length) {
      console.warn(`  [aviso] Linha ${idx + 2} tem ${values.length} colunas, esperado ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((h, i) => [h, values[i]?.trim() ?? ""]));
  });
}

function toDate(yyyyMm: string): Date {
  if (!yyyyMm || !/^\d{4}-\d{2}$/.test(yyyyMm)) {
    throw new Error(`Formato de data inválido: "${yyyyMm}". Esperado: AAAA-MM`);
  }
  return new Date(`${yyyyMm}-01T00:00:00.000Z`);
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validações iniciais
// ─────────────────────────────────────────────────────────────────────────────

async function validate() {
  const produtoCount  = await prisma.produto.count();
  const unidadeCount  = await prisma.unidadeVenda.count();
  const orcamentoCount = await prisma.orcamentoItem.count();

  console.log(`  Produtos no banco:        ${produtoCount}`);
  console.log(`  Unidades de venda:        ${unidadeCount}`);
  console.log(`  OrcamentoItems:           ${orcamentoCount}`);

  if (produtoCount === 0) throw new Error("Nenhum produto encontrado. Execute seed-import.ts primeiro.");
  if (unidadeCount === 0) throw new Error("Nenhuma unidade encontrada. Execute seed-import.ts primeiro.");
  if (orcamentoCount === 0) {
    console.warn("  [aviso] Nenhum OrcamentoItem encontrado — card de Desvios Críticos ficará vazio.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Carga principal
// ─────────────────────────────────────────────────────────────────────────────

async function loadForecast() {
  console.log("\n[Fase 1] Carregando ForecastItem.csv...");
  const rows = parseCsv("ForecastItem.csv");

  if (rows.length === 0) {
    console.log("  Nenhuma linha encontrada no CSV.");
    return;
  }

  // Pré-carrega mapa unidadeVendaId → gestorId via UserUnidadeVenda
  const gestorPorUnidade = new Map<string, string>();

  const vinculos = await prisma.userUnidadeVenda.findMany({
    where: { role: "GESTOR", ativo: true },
    select: { unidadeVendaId: true, userId: true, user: { select: { nome: true } } },
  });
  for (const v of vinculos) {
    if (!gestorPorUnidade.has(v.unidadeVendaId)) {
      gestorPorUnidade.set(v.unidadeVendaId, v.userId);
      console.log(`  Unidade "${v.unidadeVendaId}" → gestor "${v.user.nome}"`);
    }
  }

  if (gestorPorUnidade.size === 0) {
    console.warn("  [aviso] Nenhum vínculo GESTOR encontrado em UserUnidadeVenda.");
  }

  // Fallback: admin para unidades sem gestor vinculado
  const adminUser = await prisma.user.findFirst({ where: { perfil: "admin" } });
  if (adminUser) {
    console.log(`  Fallback para unidades sem gestor: "${adminUser.nome}" (admin)`);
  } else {
    console.warn("  [aviso] Nenhum usuário admin encontrado — unidades sem gestor não terão overrides.");
  }

  // Constrói mapa refMonth → runId (cria ForecastRun se não existir)
  const refMonths = [...new Set(rows.map((r) => r.refMonth?.trim()).filter(Boolean))];
  const runMap: Record<string, string> = {};

  console.log(`\n  Ciclos encontrados no CSV: ${refMonths.join(", ")}`);

  for (const refMonthStr of refMonths) {
    let refDate: Date;
    try { refDate = toDate(refMonthStr); }
    catch (e: any) {
      console.warn(`  [aviso] refMonth inválido "${refMonthStr}" — ciclo ignorado.`);
      continue;
    }

    // Janela padrão: lead time 2 meses, horizonte 12 meses
    const LEAD_TIME   = 2;
    const windowStart = addMonths(refDate, LEAD_TIME);
    const windowEnd   = addMonths(windowStart, 11);

    let run = await prisma.forecastRun.findFirst({
      where: { refMonth: refDate, status: "SUCCESS" },
      orderBy: { executedAt: "desc" },
    });

    if (!run) {
      run = await prisma.forecastRun.create({
        data: {
          refMonth:       refDate,
          status:         "SUCCESS",
          windowStart,
          windowEnd,
          leadTimeMonths: LEAD_TIME,
          sourceKey:      `CSV-${refMonthStr}`,
        },
      });
      console.log(`  ✔ ForecastRun criado: ${refMonthStr} (janela ${refMonthStr.slice(0,4)}-${String(windowStart.getUTCMonth()+1).padStart(2,'0')} → ${windowEnd.getUTCFullYear()}-${String(windowEnd.getUTCMonth()+1).padStart(2,'0')})`);
    } else {
      console.log(`  ℹ ForecastRun já existia: ${refMonthStr}`);
    }

    runMap[refMonthStr] = run.id;
  }

  // Pré-carrega produtos e unidades válidos para validação
  const [produtosDb, unidadesDb] = await Promise.all([
    prisma.produto.findMany({ select: { codigo: true } }),
    prisma.unidadeVenda.findMany({ select: { codigo: true } }),
  ]);
  const produtos = new Set(produtosDb.map((p) => p.codigo));
  const unidades = new Set(unidadesDb.map((u) => u.codigo));

  let itemCount     = 0;
  let overrideCount = 0;
  let skipped       = 0;

  console.log("\n  Processando linhas do CSV...");

  for (const row of rows) {
    const refMonthStr  = row.refMonth?.trim();
    const runId        = runMap[refMonthStr];
    const produtoId    = row.produtoId?.trim();
    const unidadeVendaId = row.unidadeVendaId?.trim();

    if (!runId) {
      console.warn(`  [aviso] Ciclo "${refMonthStr}" não foi criado — linha ignorada.`);
      skipped++; continue;
    }
    if (!produtoId || !unidadeVendaId) {
      console.warn(`  [aviso] produtoId ou unidadeVendaId vazio — linha ignorada.`);
      skipped++; continue;
    }
    if (!produtos.has(produtoId)) {
      console.warn(`  [aviso] produtoId "${produtoId}" não encontrado — linha ignorada.`);
      skipped++; continue;
    }
    if (!unidades.has(unidadeVendaId)) {
      console.warn(`  [aviso] unidadeVendaId "${unidadeVendaId}" não encontrado — linha ignorada.`);
      skipped++; continue;
    }

    let month: Date;
    try { month = toDate(row.month?.trim()); }
    catch (e: any) {
      console.warn(`  [aviso] Data inválida "${row.month}" — linha ignorada.`);
      skipped++; continue;
    }

    const volumeIA = row.volumeIA?.trim() ? parseInt(row.volumeIA.trim(), 10) : null;

    const item = await prisma.forecastItem.upsert({
      where: {
        runId_produtoId_unidadeVendaId_month_paisIso3: { runId, produtoId, unidadeVendaId, month, paisIso3: null },
      },
      create: { runId, produtoId, unidadeVendaId, month, volumeIA, paisIso3: null, source: "AIRFLOW", gestorExcluido: false },
      update: { volumeIA },
    });

    itemCount++;

    // ForecastOverride (FCTS confirmado pelo gestor)
    const volumeFCTSRaw = row.volumeFCTS?.trim();
    const gestorId = gestorPorUnidade.get(unidadeVendaId) ?? adminUser?.id;
    if (volumeFCTSRaw && gestorId) {
      const volumeFCTS = parseInt(volumeFCTSRaw, 10);
      if (!isNaN(volumeFCTS)) {
        await prisma.forecastOverride.upsert({
          where: { forecastItemId: item.id },
          create: { forecastItemId: item.id, gestorId, volumeFCTS },
          update: { gestorId, volumeFCTS },
        });
        overrideCount++;
      }
    } else if (volumeFCTSRaw && !gestorId) {
      console.warn(`  [aviso] Sem gestor para unidade "${unidadeVendaId}" — override ignorado (prod: ${produtoId})`);
    }
  }

  console.log(`\n  ✔ ForecastItems:      ${itemCount} carregados`);
  console.log(`  ✔ ForecastOverrides:  ${overrideCount} criados/atualizados`);
  if (skipped > 0) console.warn(`  [aviso] ${skipped} linhas ignoradas`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumo pós-carga
// ─────────────────────────────────────────────────────────────────────────────

async function printSummary() {
  const [runs, items, overrides] = await Promise.all([
    prisma.forecastRun.count({ where: { status: "SUCCESS" } }),
    prisma.forecastItem.count({ where: { gestorExcluido: false } }),
    prisma.forecastOverride.count(),
  ]);

  console.log("\n  Estado atual do banco:");
  console.log(`  ForecastRun (SUCCESS):  ${runs}`);
  console.log(`  ForecastItem (ativos):  ${items}`);
  console.log(`  ForecastOverride:       ${overrides}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  CARGA DE FORECAST — seed-forecast.ts");
  console.log("  (incremental — não apaga dados existentes)");
  console.log("=".repeat(60));
  console.log(`  Diretório de dados: ${DATA_DIR}\n`);

  console.log("[Validações iniciais]");
  await validate();

  await loadForecast();

  console.log("\n[Resumo final]");
  await printSummary();

  console.log("\n" + "=".repeat(60));
  console.log("  Carga concluída com sucesso!");
  console.log("  Dicas:");
  console.log("  - Verifique o Dashboard para checar Desvios Críticos");
  console.log("  - A Acurácia aparece ao ter ≥2 meses com FCTS + Vendas");
  console.log("  - O TendenciaChart exige VendaMensal populado");
  console.log("=".repeat(60));
}

main()
  .catch((e) => {
    console.error("\n[ERRO FATAL]", e.message);
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
