/**
 * Seed de ciclos históricos de forecast a partir de CSV.
 * Popula ForecastRun + ForecastItem + ForecastOverride.
 * Indicado para ciclos feitos em planilha (sem volumeIA — apenas volumeFCTS).
 *
 * Estrutura do CSV (separador ";" ou ",", detectado automaticamente):
 *   refMonth;produtoId;unidadeVendaId;month;volumeFCTS;paisIso3
 *   2025-01;100030;3101001;2025-03;120;
 *   2025-01;100030;3201004;2025-03;40;BRA
 *
 * Campos:
 *   refMonth       — ciclo (AAAA-MM); um ForecastRun por valor único
 *   produtoId      — FK para Produto.codigo
 *   unidadeVendaId — FK para UnidadeVenda.codigo
 *   month          — mês alvo da previsão (AAAA-MM)
 *   volumeFCTS     — valor comprometido pelo gestor (inteiro)
 *   paisIso3       — opcional; deixar vazio para nacionais
 *
 * Flags:
 *   --purge-null-pais   Remove ForecastItems com paisIso3 IS NULL para cada
 *                       combinação (runId, unidadeVendaId) encontrada no CSV
 *                       antes de inserir os novos itens. Útil para limpar
 *                       itens "cegos" de unidades EXPORT que foram gerados
 *                       sem distinção de país.
 *
 * Execute dentro do container backend:
 *   npx tsx prisma/seed-forecast-csv.ts
 *   npx tsx prisma/seed-forecast-csv.ts MeuArquivo.csv
 *   npx tsx prisma/seed-forecast-csv.ts MeuArquivo.csv --purge-null-pais
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { endOfBusinessDay } from "../src/utils/business-time.js";

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const args           = process.argv.slice(2);
const csvArg         = args.find((a: string) => !a.startsWith("--")) ?? "ForecastItem.csv";
const purgeNullPais  = args.includes("--purge-null-pais");
const CSV_PATH       = path.resolve(__dirname, "data", csvArg);

const LEAD_TIME       = 2;
const CYCLE_CLOSE_DAY = 20;

function parseMonth(raw: string): Date {
  const [year, month] = raw.trim().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

function detectSeparator(headerLine: string): string {
  const commaCount     = (headerLine.match(/,/g) ?? []).length;
  const semicolonCount = (headerLine.match(/;/g) ?? []).length;
  return semicolonCount >= commaCount ? ";" : ",";
}

function readCsv(filePath: string) {
  const content = fs.readFileSync(filePath, "utf-8")
    .replace(/^\uFEFF/, "")       // remove BOM
    .replace(/\r\n/g, "\n")       // normalize CRLF
    .replace(/\r/g, "\n");

  const lines = content.split("\n").filter((l: string) => l.trim() !== "");
  const [headerLine, ...dataLines] = lines;

  const sep     = detectSeparator(headerLine);
  const headers = headerLine.split(sep).map((h: string) => h.trim());

  console.log(`  Separador detectado: "${sep}"`);
  console.log(`  Colunas: ${headers.join(", ")}`);

  return dataLines.map((line: string) => {
    const values = line.split(sep).map((v: string) => v.trim());
    return Object.fromEntries(headers.map((h: string, i: number) => [h, values[i] ?? ""]));
  }) as Record<string, string>[];
}

async function main() {
  console.log(`\n🌱 Seed ForecastHistorico a partir de: ${path.basename(CSV_PATH)}`);
  if (purgeNullPais) console.log(`⚠️  Flag --purge-null-pais ativa — itens sem país serão removidos antes da inserção\n`);

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Arquivo não encontrado: ${CSV_PATH}\nColoque o arquivo em backend/prisma/data/`);
  }

  const rows = readCsv(CSV_PATH);
  console.log(`📄 ${rows.length} linhas lidas\n`);

  // ── Pré-carrega FKs válidas ───────────────────────────────────────────────
  const produtosValidos = new Set(
    (await prisma.produto.findMany({ select: { codigo: true } })).map((p) => p.codigo)
  );
  const unidadesValidas = new Set(
    (await prisma.unidadeVenda.findMany({ select: { codigo: true } })).map((u) => u.codigo)
  );
  const paisesValidos = new Set(
    (await prisma.pais.findMany({ select: { iso3: true } })).map((p) => p.iso3)
  );

  const adminUser = await prisma.user.findFirst({ where: { perfil: "operador_pcp" } });
  if (!adminUser) {
    throw new Error("Nenhum usuário operador_pcp encontrado — necessário para criar ForecastOverride e DivisionSubmission.");
  }

  // ── Garante ForecastRun para cada refMonth único ──────────────────────────
  const refMonths = [
    ...new Set(rows.map((r: Record<string, string>) => r.refMonth?.trim()).filter((v): v is string => !!v)),
  ] as string[];
  const runMap = new Map<string, string>(); // refMonth → runId

  console.log("── ForecastRuns ─────────────────────────────────────────");
  for (const refMonthStr of refMonths) {
    const refDate     = parseMonth(refMonthStr);
    const windowStart = addMonths(refDate, LEAD_TIME);
    const windowEnd   = addMonths(windowStart, 11);

    const availableFrom  = refDate;
    const availableUntil = endOfBusinessDay(
      refDate.getUTCFullYear(), refDate.getUTCMonth(), CYCLE_CLOSE_DAY,
    );

    let run = await prisma.forecastRun.findFirst({ where: { refMonth: refDate } });
    if (!run) {
      run = await prisma.forecastRun.create({
        data: {
          refMonth:       refDate,
          status:         "SUCCESS",
          windowStart,
          windowEnd,
          leadTimeMonths: LEAD_TIME,
          availableFrom,
          availableUntil,
          sourceKey:      `CSV-${refMonthStr}`,
        },
      });
      console.log(`  ✔ ForecastRun ${refMonthStr} criado: ${run.id}`);
    } else {
      await prisma.forecastRun.update({
        where: { id: run.id },
        data:  { availableFrom, availableUntil },
      });
      console.log(`  ℹ️  ForecastRun ${refMonthStr} já existia — availableFrom/Until atualizados`);
    }

    // CycleReadinessLog — garante gate=READY para todos os ciclos do CSV
    await prisma.cycleReadinessLog.upsert({
      where:  { refMonth: refDate },
      create: { refMonth: refDate, gate: "READY" },
      update: { gate: "READY" },
    });

    runMap.set(refMonthStr, run.id);
  }

  // ── Purge de itens sem país (--purge-null-pais) ───────────────────────────
  if (purgeNullPais) {
    console.log("\n── Purge paisIso3 IS NULL ───────────────────────────────");

    // Coleta combinações únicas de (runId, unidadeVendaId) presentes no CSV
    const purgePairs = new Set<string>();
    for (const row of rows) {
      const runId          = runMap.get(row.refMonth?.trim());
      const unidadeVendaId = row.unidadeVendaId?.trim();
      const paisIso3       = row.paisIso3?.trim() || null;
      if (runId && unidadeVendaId && paisIso3 !== null) {
        // Só purga unidades que têm paisIso3 definido no CSV (unidades EXPORT)
        purgePairs.add(`${runId}|${unidadeVendaId}`);
      }
    }

    for (const pair of Array.from(purgePairs)) {
      const [runId, unidadeVendaId] = (pair as string).split("|");
      const deleted = await prisma.forecastItem.deleteMany({
        where: { runId, unidadeVendaId, paisIso3: null },
      });
      if (deleted.count > 0) {
        console.log(`  🗑  ${deleted.count} itens sem país removidos — run ${runId.slice(0, 8)}... / unidade ${unidadeVendaId}`);
      }
    }
  }

  // ── Inserção de ForecastItem + ForecastOverride ───────────────────────────
  console.log("\n── ForecastItems + Overrides ────────────────────────────");

  let created   = 0;
  let updated   = 0;
  let skipped   = 0;
  let overrides = 0;

  for (const row of rows) {
    const refMonthStr    = row.refMonth?.trim();
    const produtoId      = row.produtoId?.trim();
    const unidadeVendaId = row.unidadeVendaId?.trim();
    const monthStr       = row.month?.trim();
    const volumeFCTSRaw  = row.volumeFCTS?.trim();
    const paisIso3       = row.paisIso3?.trim() || null;

    const runId = runMap.get(refMonthStr);

    // Validações
    if (!runId || !produtoId || !unidadeVendaId || !monthStr) {
      console.warn(`  ⚠️  Campos obrigatórios ausentes — linha ignorada: ${JSON.stringify(row)}`);
      skipped++; continue;
    }
    if (!produtosValidos.has(produtoId)) {
      console.warn(`  ⚠️  produtoId "${produtoId}" não encontrado — ignorado`);
      skipped++; continue;
    }
    if (!unidadesValidas.has(unidadeVendaId)) {
      console.warn(`  ⚠️  unidadeVendaId "${unidadeVendaId}" não encontrada — ignorada`);
      skipped++; continue;
    }
    if (paisIso3 && !paisesValidos.has(paisIso3)) {
      console.warn(`  ⚠️  paisIso3 "${paisIso3}" não encontrado em Pais — ignorado`);
      skipped++; continue;
    }

    const month = parseMonth(monthStr);

    // ForecastItem — findFirst + create/update (paisIso3 pode ser null)
    let item = await prisma.forecastItem.findFirst({
      where: { runId, produtoId, unidadeVendaId, month, paisIso3 },
    });

    if (item) {
      updated++;
    } else {
      item = await prisma.forecastItem.create({
        data: {
          runId,
          produtoId,
          unidadeVendaId,
          month,
          volumeIA:       null,
          paisIso3,
          source:         "AIRFLOW",
          gestorExcluido: false,
        },
      });
      created++;
    }

    // ForecastOverride — apenas se volumeFCTS preenchido
    if (volumeFCTSRaw) {
      const volumeFCTS = parseInt(volumeFCTSRaw, 10);
      if (!isNaN(volumeFCTS)) {
        await prisma.forecastOverride.upsert({
          where:  { forecastItemId: item.id },
          create: { forecastItemId: item.id, gestorId: adminUser.id, volumeFCTS },
          update: { volumeFCTS, gestorId: adminUser.id },
        });
        overrides++;
      }
    }
  }

  // ── DivisionSubmission APPROVED para ciclos históricos ───────────────────
  // Cria um registro de submissão aprovada por unidade+refMonth do CSV,
  // para que o consolidado e o histórico de aprovações reflitam os dados.
  console.log("\n── DivisionSubmissions (histórico) ─────────────────────");

  const now = new Date();

  // Coleta pares únicos (refMonthStr, unidadeVendaId) do CSV
  const submissionPairs = new Set<string>();
  for (const row of rows) {
    const refMonthStr    = row.refMonth?.trim();
    const unidadeVendaId = row.unidadeVendaId?.trim();
    if (refMonthStr && unidadeVendaId && unidadesValidas.has(unidadeVendaId)) {
      submissionPairs.add(`${refMonthStr}|${unidadeVendaId}`);
    }
  }

  let submissionsCreated = 0;
  let submissionsSkipped = 0;

  for (const pair of Array.from(submissionPairs)) {
    const [refMonthStr, unidadeVendaId] = (pair as string).split("|");
    const refMonth = parseMonth(refMonthStr);

    // Só cria se o ciclo já encerrou (availableUntil no passado)
    const availableUntil = endOfBusinessDay(
      refMonth.getUTCFullYear(), refMonth.getUTCMonth(), CYCLE_CLOSE_DAY,
    );
    if (availableUntil > now) {
      console.log(`  ⏭  ${refMonthStr} / ${unidadeVendaId} — ciclo ainda aberto, submission não criada`);
      submissionsSkipped++;
      continue;
    }

    await prisma.divisionSubmission.upsert({
      where:  { refMonth_unidadeVendaId: { refMonth, unidadeVendaId } },
      create: {
        refMonth,
        unidadeVendaId,
        status:      "APPROVED",
        autorId:     adminUser.id,
        revisorId:   adminUser.id,
        submittedAt: availableUntil,
        reviewedAt:  availableUntil,
      },
      update: {}, // não sobrescreve se já existir
    });
    submissionsCreated++;
  }

  // ── Resumo ────────────────────────────────────────────────────────────────
  console.log(`
✅ Concluído!
   ForecastItems  : ${created} criados | ${updated} já existiam
   ForecastOverrides: ${overrides} upsertados
   DivisionSubmissions: ${submissionsCreated} garantidas | ${submissionsSkipped} ciclos abertos (ignorados)
   Linhas ignoradas: ${skipped}
`);
}

main()
  .catch((e) => { console.error("❌ Erro:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
