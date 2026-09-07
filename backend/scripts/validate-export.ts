#!/usr/bin/env tsx
/**
 * validate-export.ts
 *
 * Valida a consistência do fluxo Forecast → Protheus comparando:
 *   Camada 1 — ForecastOverride          : o que o gestor definiu (agregado por país p/ EXPORT)
 *   Camada 2 — ConsolidadoProdutoSnapshot : como ficou consolidado nos snapshots
 *   Camada 3 — ProtheusExportItem         : o que foi enviado (quando disponível)
 *   Camada 4 — Protheus API (GET)         : o que está no ERP agora
 *
 * Modos (detectados automaticamente):
 *   Pipeline Completo  — ProtheusExportLog SUCCESS/PARTIAL existe → compara 4 camadas
 *   Reconciliação      — sem log → compara Override + Snapshot vs Protheus
 *
 * Uso (a partir de /backend):
 *   npx tsx scripts/validate-export.ts --refMonth=2026-10
 *   npx tsx scripts/validate-export.ts --refMonth=2026-10 --logId=<uuid>
 *   npx tsx scripts/validate-export.ts --refMonth=2026-10 --unidade=3101001
 *   npx tsx scripts/validate-export.ts --refMonth=2026-10 --verbose
 *   npx tsx scripts/validate-export.ts --refMonth=2026-10 --csv           (gera CSV com nome padrão)
 *   npx tsx scripts/validate-export.ts --refMonth=2026-10 --csv=/tmp/x.csv (gera CSV no caminho indicado)
 */

import { PrismaClient } from "@prisma/client";
import * as https from "https";
import * as http from "http";
import * as fs from "fs";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const prisma = new PrismaClient({ log: [] });

// ── Variáveis de ambiente ──────────────────────────────────────────────────────

const PROTHEUS_BASE_URL = (process.env.PROTHEUS_BASE_URL ?? "").replace(/\/$/, "");
const PROTHEUS_USER     = process.env.PROTHEUS_USER     ?? "";
const PROTHEUS_PASSWORD = process.env.PROTHEUS_PASSWORD ?? "";

if (!PROTHEUS_BASE_URL || !PROTHEUS_USER || !PROTHEUS_PASSWORD) {
  console.error("ERRO: PROTHEUS_BASE_URL, PROTHEUS_USER e PROTHEUS_PASSWORD são obrigatórios no .env");
  process.exit(1);
}

const BASIC_AUTH = "Basic " + Buffer.from(`${PROTHEUS_USER}:${PROTHEUS_PASSWORD}`).toString("base64");

// ── CLI ────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (key: string) => args.find(a => a.startsWith(`--${key}=`))?.split("=").slice(1).join("=");

  // --csv (sem valor → caminho padrão)  |  --csv=/caminho.csv (caminho explícito)  |  ausente → undefined
  const csvArg = args.find(a => a === "--csv" || a.startsWith("--csv="));
  const csv: string | true | undefined =
    csvArg === undefined ? undefined : (csvArg.includes("=") ? csvArg.split("=").slice(1).join("=") : true);

  return {
    refMonth: get("refMonth"),
    logId:    get("logId"),
    unidade:  get("unidade"),
    verbose:  args.includes("--verbose"),
    csv,
  };
}

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface ProtheusItem {
  data:       string;    // "YYYYMMDD"
  classe:     string;
  tipo:       string;
  produto:    string;
  quantidade: number;
  familia:    string | null;
}

interface ProtheusPage {
  status:    number;
  metaDados: { total: number; pagAtual: number; totalPaginas: number; totalItens: number };
  itens:     ProtheusItem[];
}

// chave: "produto|YYYYMM" → quantidade total
type ProtheusMap = Map<string, number>;

// Linha da verificação para exportação em CSV (acumulada nos dois modos)
interface CsvRow {
  unidade:  string;
  produto:  string;
  mes:      string;            // "YYYYMM"
  override: number | null;
  snapshot: number | null;
  exportV:  number | null;     // null no modo Reconciliação (sem ExportItem)
  protheus: number | null;
  delta:    number;            // protheus − referência (export no pipeline; override na reconciliação)
  status:   "OK" | "DIVERGENCIA" | "AVISO";
  obs:      string;
}

// ── HTTP ───────────────────────────────────────────────────────────────────────

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      { headers: { Authorization: BASIC_AUTH }, rejectUnauthorized: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end",  ()          => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(20_000, () => { req.destroy(); reject(new Error("timeout (20s)")); });
  });
}

// ── Helpers de data ────────────────────────────────────────────────────────────

function toYYYYMM(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toYYYYMMDD(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function lastDayOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

// ── Consulta paginada ao Protheus ──────────────────────────────────────────────

async function queryProtheus(
  unidade:     string,
  windowStart: Date,
  windowEnd:   Date
): Promise<{ map: ProtheusMap; totalItens: number }> {
  const dataDe  = toYYYYMMDD(windowStart);
  const dataAte = toYYYYMMDD(lastDayOfMonth(windowEnd));
  const map: ProtheusMap = new Map();
  let page       = 1;
  let totalPages = 1;
  let totalItens = 0;

  do {
    const url =
      `${PROTHEUS_BASE_URL}/rest02/ForecastXProtheus/listaprevisoes` +
      `?cClasse=${encodeURIComponent(unidade)}&cTipo=R` +
      `&cDataDe=${dataDe}&cDataAte=${dataAte}&nPage=${page}`;

    let body: ProtheusPage;
    try {
      const raw = await httpGet(url);
      body = JSON.parse(raw) as ProtheusPage;
    } catch (e) {
      throw new Error(`Protheus GET falhou (unidade=${unidade}, pág=${page}): ${e}`);
    }

    if (!body?.metaDados) throw new Error(`Resposta inesperada do Protheus para ${unidade}`);

    totalPages = body.metaDados.totalPaginas;
    totalItens = body.metaDados.total;

    for (const item of body.itens ?? []) {
      // "YYYYMMDD" → "YYYYMM"
      const yyyymm = item.data.substring(0, 6);
      const key    = `${item.produto}|${yyyymm}`;
      map.set(key, (map.get(key) ?? 0) + item.quantidade);
    }

    page++;
  } while (page <= totalPages);

  return { map, totalItens };
}

// ── Formatação / cores ─────────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
};

const ok   = (s: string) => `${C.green}✓${C.reset} ${s}`;
const fail = (s: string) => `${C.red}✗${C.reset} ${s}`;
const warn = (s: string) => `${C.yellow}⚠${C.reset}  ${s}`;

function fmt(v: number | null | undefined): string {
  if (v == null) return `${C.dim}—${C.reset}`;
  return v.toLocaleString("pt-BR");
}

function colored(v: number, ref: number): string {
  if (v === ref) return `${C.green}${fmt(v)}${C.reset}`;
  return `${C.red}${fmt(v)}${C.reset}`;
}

function deltaStr(a: number, b: number): string {
  const d = b - a;
  if (d === 0) return "";
  return `${C.red}Δ${d > 0 ? "+" : ""}${d}${C.reset}`;
}

// ── CSV ──────────────────────────────────────────────────────────────────────
// Escreve a verificação como CSV (separador ";" + BOM UTF-8 → abre direto no Excel pt-BR).

function writeCsv(filePath: string, rows: CsvRow[]) {
  const header = ["unidade", "produto", "mes", "override", "snapshot", "export", "protheus", "delta", "status", "obs"];
  const num    = (v: number | null) => (v == null ? "" : String(v));
  const esc    = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

  const lines = [header.join(";")];
  for (const r of rows) {
    lines.push([
      r.unidade, r.produto, r.mes,
      num(r.override), num(r.snapshot), num(r.exportV), num(r.protheus),
      String(r.delta), r.status, esc(r.obs),
    ].join(";"));
  }
  fs.writeFileSync(filePath, "﻿" + lines.join("\r\n") + "\r\n", "utf8");
}

// ── Modo Pipeline Completo ─────────────────────────────────────────────────────
// Usa ProtheusExportLog + ExportItems como âncora — compara 4 camadas.

async function runFullPipeline(logId: string, unidadeFilter: string | undefined, verbose: boolean, csvRows?: CsvRow[]) {
  const log = await prisma.protheusExportLog.findUnique({
    where:   { id: logId },
    include: {
      items: {
        where:   unidadeFilter ? { unidadeVendaId: unidadeFilter } : undefined,
        orderBy: [{ unidadeVendaId: "asc" }, { month: "asc" }, { produtoId: "asc" }],
      },
    },
  });
  if (!log) throw new Error(`ProtheusExportLog não encontrado: ${logId}`);

  const run = await prisma.forecastRun.findFirst({
    where:   { refMonth: log.refMonth, status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
    select:  { id: true, windowStart: true, windowEnd: true },
  });
  if (!run?.windowStart || !run?.windowEnd) throw new Error("ForecastRun sem janela definida");

  if (log.items.length === 0) {
    console.log(warn("Nenhum ProtheusExportItem encontrado para este log/unidade."));
    return;
  }

  const unidadesNoLog = [...new Set(log.items.map(i => i.unidadeVendaId))];
  const monthsNoLog   = [...new Set(log.items.map(i => i.month))];

  // Agrega overrides por unidade+produto+mês somando TODOS os países (mesmo que getApprovedForecastData).
  // ProtheusExportItem.overrideId aponta só para o 1º país processado — não usar diretamente em EXPORT.
  const [forecastItemsRaw, snapshots] = await Promise.all([
    prisma.forecastItem.findMany({
      where: {
        runId:          run.id,
        unidadeVendaId: { in: unidadesNoLog },
        month:          { in: monthsNoLog },
        gestorExcluido: false,
      },
      select: {
        produtoId:      true,
        unidadeVendaId: true,
        month:          true,
        overrides: { take: 1, orderBy: { updatedAt: "desc" }, select: { volumeFCTS: true } },
      },
    }),
    prisma.consolidadoProdutoMesSnapshot.findMany({
      where: {
        unidadeVendaId: { in: unidadesNoLog },
        refMonth:       { in: monthsNoLog },
      },
      select: { unidadeVendaId: true, produtoId: true, refMonth: true, fcts: true },
    }),
  ]);

  // "unidade|produto|YYYYMM" → volumeFCTS somado (todos os países)
  const aggOverrideMap = new Map<string, number>();
  for (const fi of forecastItemsRaw) {
    const vol = fi.overrides[0]?.volumeFCTS;
    if (!vol || vol <= 0) continue;
    const key = `${fi.unidadeVendaId}|${fi.produtoId}|${toYYYYMM(fi.month)}`;
    aggOverrideMap.set(key, (aggOverrideMap.get(key) ?? 0) + vol);
  }

  // "unidade|produto|YYYYMM" → fcts
  const snapshotMap = new Map(
    snapshots.map(s => [`${s.unidadeVendaId}|${s.produtoId}|${toYYYYMM(s.refMonth)}`, s.fcts])
  );

  // Agrupa items por unidade
  const byUnidade = new Map<string, typeof log.items>();
  for (const item of log.items) {
    const arr = byUnidade.get(item.unidadeVendaId) ?? [];
    arr.push(item);
    byUnidade.set(item.unidadeVendaId, arr);
  }

  const refMonthStr = log.refMonth.toISOString().substring(0, 7);

  // ── Cabeçalho ────────────────────────────────────────────────────────────────
  console.log(`\n${C.bold}${"═".repeat(72)}${C.reset}`);
  console.log(`${C.bold}  VALIDAÇÃO — PIPELINE COMPLETO${C.reset}`);
  console.log(`  Ciclo  : ${C.bold}${refMonthStr}${C.reset}   Status log: ${C.bold}${log.status}${C.reset}`);
  console.log(`  Janela : ${toYYYYMM(run.windowStart)} → ${toYYYYMM(run.windowEnd)}`);
  console.log(`  Log ID : ${log.id}`);
  if (unidadeFilter) console.log(`  Filtro : unidade=${unidadeFilter}`);
  console.log(`  ${C.dim}Colunas: Override → Snapshot → ExportItem → Protheus${C.reset}`);
  console.log(`${C.bold}${"═".repeat(72)}${C.reset}\n`);

  let totalOk = 0, totalFail = 0, totalWarn = 0;

  for (const [unidade, items] of byUnidade) {
    process.stdout.write(`${C.cyan}${C.bold}▸ ${unidade}${C.reset}  consultando Protheus…`);

    let protheusMap: ProtheusMap;
    let protheusTotal: number;
    try {
      const result  = await queryProtheus(unidade, run.windowStart, run.windowEnd);
      protheusMap   = result.map;
      protheusTotal = result.totalItens;
      process.stdout.write(`\r${C.cyan}${C.bold}▸ ${unidade}${C.reset}  (${items.length} linhas export, ${protheusTotal} itens Protheus)\n`);
    } catch (e) {
      process.stdout.write(`\r${fail(`${unidade}  Erro ao consultar Protheus: ${e}`)}\n\n`);
      totalFail += items.length;
      continue;
    }

    const unitFails: string[] = [];
    const unitWarns: string[] = [];

    for (const item of items) {
      const yyyymm    = toYYYYMM(item.month);
      const exportV   = item.volumeFCTS;
      const overrideV = aggOverrideMap.get(`${unidade}|${item.produtoId}|${yyyymm}`) ?? null;
      const snapshotV = snapshotMap.get(`${unidade}|${item.produtoId}|${yyyymm}`) ?? null;
      const protheusV = protheusMap.get(`${item.produtoId}|${yyyymm}`) ?? 0;

      // Consistência: export é a referência (o que foi enviado)
      const exportOk   = protheusV === exportV;
      const overrideOk = overrideV === null || overrideV === exportV;
      const snapshotOk = snapshotV === null || snapshotV === exportV;
      const allOk      = exportOk && overrideOk && snapshotOk;

      // Item marcado SUCCESS no log mas ausente no ERP (vira observação na linha do CSV)
      const sucessoMasZero = item.status === "SUCCESS" && exportV > 0 && protheusV === 0;

      csvRows?.push({
        unidade,
        produto:  item.produtoId,
        mes:      yyyymm,
        override: overrideV,
        snapshot: snapshotV,
        exportV,
        protheus: protheusV,
        delta:    protheusV - exportV,
        status:   allOk ? (sucessoMasZero ? "AVISO" : "OK") : "DIVERGENCIA",
        obs:      sucessoMasZero ? "enviado como SUCCESS mas Protheus retorna 0" : "",
      });

      if (allOk) {
        totalOk++;
        if (verbose) {
          console.log(`  ${ok(`${item.produtoId} | ${yyyymm} | ${fmt(overrideV)} → ${fmt(snapshotV)} → ${fmt(exportV)} → ${fmt(protheusV)}`)}`);
        }
      } else {
        totalFail++;
        const line = [
          `${C.bold}${item.produtoId}${C.reset}`,
          yyyymm,
          `Ovrd:${overrideV !== null ? colored(overrideV, exportV) : `${C.dim}—${C.reset}`}`,
          `Snap:${snapshotV !== null ? colored(snapshotV, exportV) : `${C.dim}—${C.reset}`}`,
          `Exp:${C.bold}${fmt(exportV)}${C.reset}`,
          `Proto:${colored(protheusV, exportV)}`,
          deltaStr(exportV, protheusV),
        ].filter(Boolean).join("  ");
        unitFails.push(`  ${fail(line)}`);
      }

      // Alerta: item marcado SUCCESS no log mas ausente no ERP
      if (sucessoMasZero) {
        totalWarn++;
        unitWarns.push(`  ${warn(`${item.produtoId} | ${yyyymm} — enviado como SUCCESS mas Protheus retorna 0`)}`);
      }
    }

    // Itens no Protheus que não estão no export (resíduo de ciclo anterior)
    const exportKeys = new Set(items.map(i => `${i.produtoId}|${toYYYYMM(i.month)}`));
    for (const [key, qty] of protheusMap) {
      if (!exportKeys.has(key) && qty > 0) {
        const [prod, mes] = key.split("|");
        totalWarn++;
        unitWarns.push(`  ${warn(`${prod} | ${mes} — presente no Protheus (${fmt(qty)}) mas não está no export (resíduo?)`)}`);
        csvRows?.push({
          unidade, produto: prod, mes,
          override: null, snapshot: null, exportV: null, protheus: qty,
          delta: qty, status: "AVISO",
          obs: "presente no Protheus mas ausente no export (resíduo?)",
        });
      }
    }

    if (unitFails.length === 0 && unitWarns.length === 0) {
      console.log(`  ${ok(`${items.length} linhas OK`)}`);
    } else {
      unitFails.forEach(l => console.log(l));
      unitWarns.forEach(l => console.log(l));
    }
    console.log();
  }

  // ── Rodapé ───────────────────────────────────────────────────────────────────
  console.log(`${C.bold}${"─".repeat(72)}${C.reset}`);
  const failPart = totalFail > 0 ? `${C.red}${totalFail} DIVERGÊNCIAS${C.reset}` : `${totalFail} DIVERGÊNCIAS`;
  const warnPart = totalWarn > 0 ? `${C.yellow}${totalWarn} AVISOS${C.reset}`      : `${totalWarn} AVISOS`;
  console.log(`  ${C.bold}RESULTADO:${C.reset}  ${C.green}${totalOk} OK${C.reset}  |  ${failPart}  |  ${warnPart}`);
  if (!verbose && totalFail === 0) console.log(`  ${C.dim}(use --verbose para listar todas as linhas OK)${C.reset}`);
  console.log(`${C.bold}${"═".repeat(72)}${C.reset}\n`);
}

// ── Modo Reconciliação de Estado ───────────────────────────────────────────────
// Sem ProtheusExportLog — compara Override (agregado) + Snapshot vs Protheus.

async function runReconciliation(refMonth: string, unidadeFilter: string | undefined, verbose: boolean, csvRows?: CsvRow[]) {
  const refDate = new Date(refMonth);

  const run = await prisma.forecastRun.findFirst({
    where:   { refMonth: refDate, status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
    select:  { id: true, windowStart: true, windowEnd: true, sourceKey: true },
  });
  if (!run) throw new Error(`ForecastRun SUCCESS não encontrado para ${refMonth}`);
  if (!run.windowStart || !run.windowEnd) throw new Error("ForecastRun sem janela definida");

  const isBackfill = (run.sourceKey ?? "").includes("backfill");

  const approvedSubs = await prisma.divisionSubmission.findMany({
    where: {
      refMonth: refDate,
      status:   "APPROVED",
      ...(unidadeFilter ? { unidadeVendaId: unidadeFilter } : {}),
    },
    select: { unidadeVendaId: true },
  });

  if (approvedSubs.length === 0) {
    console.log(warn("Nenhuma DivisionSubmission APPROVED encontrada. Nada a comparar."));
    return;
  }

  const approvedUnits = approvedSubs.map(s => s.unidadeVendaId);

  // Carrega ForecastItems + Overrides + Snapshots em paralelo
  const [forecastItems, snapshots] = await Promise.all([
    prisma.forecastItem.findMany({
      where: {
        runId:          run.id,
        gestorExcluido: false,
        unidadeVendaId: { in: approvedUnits },
      },
      select: {
        produtoId:      true,
        unidadeVendaId: true,
        month:          true,
        paisIso3:       true,
        overrides: {
          take:    1,
          orderBy: { updatedAt: "desc" },
          select:  { volumeFCTS: true },
        },
      },
    }),
    prisma.consolidadoProdutoMesSnapshot.findMany({
      where: {
        unidadeVendaId: { in: approvedUnits },
        refMonth:       { gte: run.windowStart, lte: run.windowEnd },
      },
      select: { unidadeVendaId: true, produtoId: true, refMonth: true, fcts: true },
    }),
  ]);

  // Agrega overrides por unidade+produto+mês — soma países para unidades EXPORT
  // chave: "unidade|produto|YYYYMM" → volumeFCTS somado
  const aggMap = new Map<string, number>();
  for (const fi of forecastItems) {
    const vol = fi.overrides[0]?.volumeFCTS;
    if (!vol || vol <= 0) continue;
    const key = `${fi.unidadeVendaId}|${fi.produtoId}|${toYYYYMM(fi.month)}`;
    aggMap.set(key, (aggMap.get(key) ?? 0) + vol);
  }

  // "unidade|produto|YYYYMM" → fcts
  const snapshotMap = new Map(
    snapshots.map(s => [`${s.unidadeVendaId}|${s.produtoId}|${toYYYYMM(s.refMonth)}`, s.fcts])
  );

  // ── Cabeçalho ────────────────────────────────────────────────────────────────
  console.log(`\n${C.bold}${"═".repeat(72)}${C.reset}`);
  console.log(`${C.bold}  VALIDAÇÃO — RECONCILIAÇÃO DE ESTADO${C.reset}`);
  console.log(`  Ciclo  : ${C.bold}${refMonth}${C.reset}   Run: ${run.id.substring(0, 8)}…`);
  console.log(`  Janela : ${toYYYYMM(run.windowStart)} → ${toYYYYMM(run.windowEnd)}`);
  if (unidadeFilter) console.log(`  Filtro : unidade=${unidadeFilter}`);
  if (isBackfill) {
    console.log(`  ${C.yellow}AVISO: Ciclo de backfill — Override foi carregado FROM Protheus (comparação é circular)${C.reset}`);
    console.log(`  ${C.yellow}Divergências indicam mudanças no Protheus APÓS o backfill ou bug de distribuição${C.reset}`);
  } else {
    console.log(`  ${C.yellow}Modo Reconciliação — sem ProtheusExportLog para este ciclo${C.reset}`);
  }
  console.log(`  ${C.dim}Colunas: Override(agg) → Snapshot → Protheus${C.reset}`);
  console.log(`${C.bold}${"═".repeat(72)}${C.reset}\n`);

  let totalOk = 0, totalFail = 0, totalWarn = 0;

  for (const unidade of approvedUnits) {
    process.stdout.write(`${C.cyan}${C.bold}▸ ${unidade}${C.reset}  consultando Protheus…`);

    let protheusMap: ProtheusMap;
    let protheusTotal: number;
    try {
      const result  = await queryProtheus(unidade, run.windowStart, run.windowEnd);
      protheusMap   = result.map;
      protheusTotal = result.totalItens;
    } catch (e) {
      process.stdout.write(`\r${fail(`${unidade}  Erro ao consultar Protheus: ${e}`)}\n\n`);
      continue;
    }

    // Todas as chaves produto|YYYYMM desta unidade (override + Protheus)
    const unitOverrideKeys = new Set(
      [...aggMap.keys()]
        .filter(k => k.startsWith(`${unidade}|`))
        .map(k => k.slice(unidade.length + 1))  // "produto|YYYYMM"
    );
    const allProdMes = new Set([...unitOverrideKeys, ...protheusMap.keys()]);

    process.stdout.write(
      `\r${C.cyan}${C.bold}▸ ${unidade}${C.reset}  (${unitOverrideKeys.size} linhas override, ${protheusTotal} itens Protheus)\n`
    );

    const unitFails: string[] = [];
    const unitWarns: string[] = [];

    for (const prodMes of allProdMes) {
      const [produto, yyyymm] = prodMes.split("|");
      const overrideV = aggMap.get(`${unidade}|${prodMes}`) ?? 0;
      const snapshotV = snapshotMap.get(`${unidade}|${produto}|${yyyymm}`) ?? null;
      const protheusV = protheusMap.get(prodMes) ?? 0;

      const overrideOk = overrideV === protheusV;
      const snapshotOk = snapshotV === null || snapshotV === overrideV;
      const allOk      = overrideOk && snapshotOk;

      // No Protheus mas sem override (não deveria estar lá) → observação na linha do CSV
      const protheusSemOverride = protheusV > 0 && overrideV === 0 && !unitOverrideKeys.has(prodMes);

      csvRows?.push({
        unidade,
        produto:  produto,
        mes:      yyyymm,
        override: overrideV,
        snapshot: snapshotV,
        exportV:  null,
        protheus: protheusV,
        delta:    protheusV - overrideV,
        status:   allOk ? (protheusSemOverride ? "AVISO" : "OK") : "DIVERGENCIA",
        obs:      protheusSemOverride ? "presente no Protheus sem override correspondente" : "",
      });

      if (allOk) {
        totalOk++;
        if (verbose) {
          console.log(`  ${ok(`${produto} | ${yyyymm} | ${fmt(overrideV)} → ${fmt(snapshotV)} → ${fmt(protheusV)}`)}`);
        }
      } else {
        totalFail++;
        const line = [
          `${C.bold}${produto}${C.reset}`,
          yyyymm,
          `Ovrd:${overrideOk ? `${C.green}${fmt(overrideV)}${C.reset}` : `${C.red}${fmt(overrideV)}${C.reset}`}`,
          snapshotV !== null
            ? `Snap:${snapshotOk ? `${C.green}${fmt(snapshotV)}${C.reset}` : `${C.red}${fmt(snapshotV)}${C.reset}`}`
            : `Snap:${C.dim}—${C.reset}`,
          `Proto:${overrideOk ? `${C.green}${fmt(protheusV)}${C.reset}` : `${C.red}${fmt(protheusV)}${C.reset}`}`,
          overrideV !== protheusV ? deltaStr(overrideV, protheusV) : "",
        ].filter(Boolean).join("  ");
        unitFails.push(`  ${fail(line)}`);
      }

      // Alerta: no Protheus mas sem override (não deveria estar lá)
      if (protheusSemOverride) {
        totalWarn++;
        unitWarns.push(`  ${warn(`${produto} | ${yyyymm} — presente no Protheus (${fmt(protheusV)}) sem override correspondente`)}`);
      }
    }

    if (unitFails.length === 0 && unitWarns.length === 0) {
      console.log(`  ${ok(`${allProdMes.size} linhas OK`)}`);
    } else {
      unitFails.forEach(l => console.log(l));
      unitWarns.forEach(l => console.log(l));
    }
    console.log();
  }

  // ── Rodapé ───────────────────────────────────────────────────────────────────
  console.log(`${C.bold}${"─".repeat(72)}${C.reset}`);
  const failPart = totalFail > 0 ? `${C.red}${totalFail} DIVERGÊNCIAS${C.reset}` : `${totalFail} DIVERGÊNCIAS`;
  const warnPart = totalWarn > 0 ? `${C.yellow}${totalWarn} AVISOS${C.reset}`      : `${totalWarn} AVISOS`;
  console.log(`  ${C.bold}RESULTADO:${C.reset}  ${C.green}${totalOk} OK${C.reset}  |  ${failPart}  |  ${warnPart}`);
  if (isBackfill && totalFail > 0) {
    console.log(`  ${C.yellow}Ciclo de backfill: as divergências acima representam mudanças feitas no ERP após o backfill${C.reset}`);
  }
  if (!verbose && totalFail === 0) console.log(`  ${C.dim}(use --verbose para listar todas as linhas OK)${C.reset}`);
  console.log(`${C.bold}${"═".repeat(72)}${C.reset}\n`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const { refMonth, logId, unidade, verbose, csv } = parseArgs();

  if (!refMonth) {
    console.error(
      "\nUso:\n" +
      "  npx tsx scripts/validate-export.ts --refMonth=YYYY-MM\n" +
      "  npx tsx scripts/validate-export.ts --refMonth=YYYY-MM --logId=<uuid>\n" +
      "  npx tsx scripts/validate-export.ts --refMonth=YYYY-MM --unidade=<codigo>\n" +
      "  npx tsx scripts/validate-export.ts --refMonth=YYYY-MM --verbose\n" +
      "  npx tsx scripts/validate-export.ts --refMonth=YYYY-MM --csv[=arquivo.csv]\n"
    );
    process.exit(1);
  }

  // Normaliza "2026-10" → "2026-10-01"
  const refMonthNorm = /^\d{4}-\d{2}$/.test(refMonth) ? `${refMonth}-01` : refMonth;

  try {
    let targetLogId = logId;

    if (!targetLogId) {
      const latestLog = await prisma.protheusExportLog.findFirst({
        where:   {
          refMonth: new Date(refMonthNorm),
          status:   { in: ["SUCCESS", "PARTIAL"] },
        },
        orderBy: { startedAt: "desc" },
        select:  { id: true, status: true, startedAt: true, unidadesOk: true, unidadesFailed: true },
      });

      if (latestLog) {
        targetLogId = latestLog.id;
        console.log(
          `\n${C.dim}ProtheusExportLog encontrado: ${latestLog.id}` +
          `  status=${latestLog.status}` +
          `  ok=${latestLog.unidadesOk}  falhas=${latestLog.unidadesFailed}` +
          `  em ${latestLog.startedAt.toISOString()}${C.reset}`
        );
      } else {
        console.log(`\n${C.dim}Nenhum ProtheusExportLog SUCCESS/PARTIAL encontrado — usando modo Reconciliação${C.reset}`);
      }
    }

    const csvRows: CsvRow[] | undefined = csv ? [] : undefined;

    if (targetLogId) {
      await runFullPipeline(targetLogId, unidade, verbose, csvRows);
    } else {
      await runReconciliation(refMonthNorm, unidade, verbose, csvRows);
    }

    if (csvRows) {
      const defaultName = `validate-export-${refMonth}${unidade ? `-${unidade}` : ""}.csv`;
      const csvPath     = path.resolve(process.cwd(), typeof csv === "string" ? csv : defaultName);
      writeCsv(csvPath, csvRows);
      console.log(`${C.cyan}CSV gerado:${C.reset} ${csvPath}  ${C.dim}(${csvRows.length} linhas)${C.reset}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error(`\n${C.red}ERRO FATAL:${C.reset}`, e instanceof Error ? e.message : e);
  process.exit(1);
});
