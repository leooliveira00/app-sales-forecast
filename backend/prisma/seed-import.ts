/**
 * seed-import.ts
 *
 * Carga de dados reais a partir de CSVs em backend/prisma/data/
 *
 * Execução:
 *   cd backend
 *   npm run seed:import
 *
 * Pré-requisitos:
 *   - Arquivos CSV em backend/prisma/data/ (ver README.md nessa pasta)
 *   - Banco de dados acessível via DATABASE_URL no .env
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

/** Lê e parseia um CSV separado por `;` (UTF-8). Retorna array de objetos. */
function parseCsv(filename: string): Record<string, string>[] {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  // Remove BOM (byte order mark) que o Excel às vezes adiciona
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
      console.warn(`  [aviso] Linha ${idx + 2} em ${filename} tem ${values.length} colunas, esperado ${headers.length}. Linha: "${line}"`);
    }
    return Object.fromEntries(headers.map((h, i) => [h, values[i]?.trim() ?? ""]));
  });
}

/** Converte "AAAA-MM" para Date UTC normalizado no 1º dia do mês. */
function toDate(yyyyMm: string): Date {
  if (!yyyyMm || !/^\d{4}-\d{2}$/.test(yyyyMm)) {
    throw new Error(`Formato de data inválido: "${yyyyMm}". Esperado: AAAA-MM`);
  }
  return new Date(`${yyyyMm}-01T00:00:00.000Z`);
}

/** Adiciona N meses a uma Date UTC. */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Converte string para booleano. Vazio ou ausente → true (default). */
function toBool(val: string, defaultVal = true): boolean {
  if (!val || val === "") return defaultVal;
  return val.toLowerCase() !== "false" && val !== "0";
}

/** Converte string para inteiro. Lança erro se inválido. */
function toInt(val: string, label: string): number {
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new Error(`Valor inteiro inválido para "${label}": "${val}"`);
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 1 — DELETE (ordem inversa de dependências; usuários e configs preservados)
// ─────────────────────────────────────────────────────────────────────────────

async function deleteAll() {
  console.log("\n[Fase 1] Limpando dados existentes...");

  const steps: Array<{ label: string; fn: () => Promise<{ count: number }> }> = [
    { label: "ForecastOverrideHistory", fn: () => prisma.forecastOverrideHistory.deleteMany() },
    { label: "ForecastOverride",        fn: () => prisma.forecastOverride.deleteMany()        },
    { label: "ForecastItem",            fn: () => prisma.forecastItem.deleteMany()            },
    { label: "ForecastRun",         fn: () => prisma.forecastRun.deleteMany()        },
    { label: "DivisionSubmission",  fn: () => prisma.divisionSubmission.deleteMany() },
    { label: "OrcamentoItem",       fn: () => prisma.orcamentoItem.deleteMany()      },
    { label: "OrcamentoRun",        fn: () => prisma.orcamentoRun.deleteMany()       },
    { label: "VendaMensal",         fn: () => prisma.vendaMensal.deleteMany()        },
    { label: "UserUnidadeVenda",    fn: () => prisma.userUnidadeVenda.deleteMany()   },
    { label: "ProdutoUnidadeVenda", fn: () => prisma.produtoUnidadeVenda.deleteMany()},
    { label: "Produto",             fn: () => prisma.produto.deleteMany()            },
    { label: "Pais",                fn: () => prisma.pais.deleteMany()               },
    { label: "UnidadeVenda",        fn: () => prisma.unidadeVenda.deleteMany()       },
  ];

  for (const step of steps) {
    const result = await step.fn();
    console.log(`  ✔ ${step.label}: ${result.count} registros removidos`);
  }

  console.log("  [ok] Usuários e SystemConfig preservados.\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 2 — UnidadeVenda (derivada de ProdutoUnidadeVenda.csv)
// ─────────────────────────────────────────────────────────────────────────────

async function loadUnidades(rows: Record<string, string>[]) {
  console.log("[Fase 2] Criando UnidadeVenda...");

  // Extrai pares únicos codigo → descricao
  const unique = new Map<string, string>();
  for (const row of rows) {
    const codigo = row.unidadeVendaId?.trim();
    // Aceita coluna opcional "unidadeVendaDescricao" para a descrição da unidade
    const descricao = row.unidadeVendaDescricao?.trim() || row.divisao?.trim() || row.descricao?.trim();
    if (codigo && !unique.has(codigo)) {
      unique.set(codigo, descricao || codigo);
    }
  }

  for (const [codigo, descricao] of unique.entries()) {
    await prisma.unidadeVenda.upsert({
      where:  { codigo },
      create: { codigo, descricao, tipo: "NACIONAL", ativo: true },
      update: { descricao },
    });
  }

  console.log(`  ✔ ${unique.size} unidades de venda criadas/atualizadas.`);
  console.log("  [aviso] Todas criadas como tipo NACIONAL. Atualize manualmente unidades de exportação no painel admin.\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 3 — Pais (opcional — necessário antes de carregar vendas de exportação)
// ─────────────────────────────────────────────────────────────────────────────

async function loadPaises() {
  const filePath = path.join(DATA_DIR, "Pais.csv");
  if (!fs.existsSync(filePath)) {
    console.log("[Fase 3] Pais.csv não encontrado — fase ignorada.");
    console.log("  [aviso] Necessário para unidades EXPORT (VendaMensal/OrcamentoItem com paisIso3).\n");
    return;
  }

  console.log("[Fase 3] Carregando Pais.csv...");
  const rows = parseCsv("Pais.csv");

  let count = 0;
  let skipped = 0;

  for (const row of rows) {
    const iso3           = row.iso3?.trim().toUpperCase();
    const nome           = row.nome?.trim();
    const unidadeVendaId = row.unidadeVendaId?.trim();

    if (!iso3) {
      console.warn("  [aviso] Linha sem iso3 ignorada.");
      skipped++; continue;
    }
    if (!nome) {
      console.warn(`  [aviso] País "${iso3}" sem nome — ignorado.`);
      skipped++; continue;
    }
    if (!unidadeVendaId) {
      console.warn(`  [aviso] País "${iso3}" sem unidadeVendaId — ignorado.`);
      skipped++; continue;
    }

    await prisma.pais.upsert({
      where:  { iso3 },
      create: { iso3, nome, unidadeVendaId, ativo: toBool(row.ativo) },
      update: { nome, unidadeVendaId, ativo: toBool(row.ativo) },
    });

    count++;
  }

  console.log(`  ✔ ${count} países carregados. ${skipped > 0 ? `(${skipped} ignorados)` : ""}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 4 — Produto
// ─────────────────────────────────────────────────────────────────────────────

async function loadProdutos() {
  console.log("[Fase 4] Carregando Produto.csv...");
  const rows = parseCsv("Produto.csv");

  let count = 0;

  for (const row of rows) {
    const codigo = row.codigo?.trim();
    if (!codigo) { console.warn("  [aviso] Linha sem codigo ignorada."); continue; }

    await prisma.produto.upsert({
      where:  { codigo },
      create: {
        codigo,
        descricao: row.descricao?.trim() || codigo,
        ncm:       row.ncm?.trim()       || null,
        classe:    row.classe?.trim()    || null,
        ativo:     toBool(row.ativo),
      },
      update: {
        descricao: row.descricao?.trim() || codigo,
        ncm:       row.ncm?.trim()       || null,
        classe:    row.classe?.trim()    || null,
        ativo:     toBool(row.ativo),
      },
    });

    count++;
  }

  console.log(`  ✔ ${count} produtos carregados.\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 5 — ProdutoUnidadeVenda
// ─────────────────────────────────────────────────────────────────────────────

async function loadProdutoUnidades(rows: Record<string, string>[]) {
  console.log("[Fase 5] Carregando ProdutoUnidadeVenda.csv...");

  const [produtosDb, unidadesDb] = await Promise.all([
    prisma.produto.findMany({ select: { codigo: true } }),
    prisma.unidadeVenda.findMany({ select: { codigo: true } }),
  ]);
  const produtos = new Set(produtosDb.map((p) => p.codigo));
  const unidades = new Set(unidadesDb.map((u) => u.codigo));

  let count = 0;
  let skipped = 0;

  for (const row of rows) {
    const produtoId    = row.produtoId?.trim();
    const unidadeVendaId = row.unidadeVendaId?.trim();

    if (!produtoId) {
      console.warn(`  [aviso] Linha sem produtoId ignorada.`);
      skipped++; continue;
    }
    if (!unidadeVendaId) {
      console.warn(`  [aviso] Linha sem unidadeVendaId ignorada.`);
      skipped++; continue;
    }

    if (!produtos.has(produtoId)) {
      console.warn(`  [aviso] produtoId "${produtoId}" não encontrado em Produto — linha ignorada.`);
      skipped++; continue;
    }

    if (!unidades.has(unidadeVendaId)) {
      console.warn(`  [aviso] unidadeVendaId "${unidadeVendaId}" não encontrado em UnidadeVenda — linha ignorada.`);
      skipped++; continue;
    }

    await prisma.produtoUnidadeVenda.upsert({
      where:  { produtoId_unidadeVendaId: { produtoId, unidadeVendaId } },
      create: {
        produtoId,
        unidadeVendaId,
        divisao: row.divisao?.trim() || null,
        familia: row.familia?.trim() || null,
        ativo:   toBool(row.ativo),
      },
      update: {
        divisao: row.divisao?.trim() || null,
        familia: row.familia?.trim() || null,
        ativo:   toBool(row.ativo),
      },
    });

    count++;
  }

  console.log(`  ✔ ${count} vínculos produto/unidade carregados. ${skipped > 0 ? `(${skipped} ignorados)` : ""}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 6 — VendaMensal
// ─────────────────────────────────────────────────────────────────────────────

async function loadVendas() {
  console.log("[Fase 6] Carregando VendaMensal.csv...");
  const rows = parseCsv("VendaMensal.csv");

  const [produtosDb, unidadesDb, paisesDb] = await Promise.all([
    prisma.produto.findMany({ select: { codigo: true } }),
    prisma.unidadeVenda.findMany({ select: { codigo: true } }),
    prisma.pais.findMany({ select: { iso3: true } }),
  ]);
  const produtos = new Set(produtosDb.map((p) => p.codigo));
  const unidades = new Set(unidadesDb.map((u) => u.codigo));
  const paises   = new Set(paisesDb.map((p) => p.iso3));

  let count = 0;
  let skipped = 0;

  for (const row of rows) {
    const produtoId    = row.produtoId?.trim();
    const unidadeVendaId = row.unidadeVendaId?.trim();

    if (!produtoId || !unidadeVendaId) {
      console.warn(`  [aviso] produtoId ou unidadeVendaId vazio — linha ignorada.`);
      skipped++; continue;
    }

    if (!produtos.has(produtoId)) {
      console.warn(`  [aviso] produtoId "${produtoId}" não encontrado em Produto — linha ignorada.`);
      skipped++; continue;
    }

    if (!unidades.has(unidadeVendaId)) {
      console.warn(`  [aviso] unidadeVendaId "${unidadeVendaId}" não encontrado em UnidadeVenda — linha ignorada.`);
      skipped++; continue;
    }

    let month: Date;
    try { month = toDate(row.month?.trim()); }
    catch (e: any) {
      console.warn(`  [aviso] Data inválida "${row.month}" — linha ignorada. (${e.message})`);
      skipped++; continue;
    }

    const canal      = row.canal?.trim() || "VENDA DIRETA";
    const receitaStr = row.receita?.trim();
    const receita    = receitaStr ? parseFloat(receitaStr.replace(",", ".")) : null;
    const paisRaw    = row.paisIso3?.trim() || null;
    const paisIso3   = paisRaw && paises.has(paisRaw) ? paisRaw : null;
    if (paisRaw && !paises.has(paisRaw)) {
      console.warn(`  [aviso] paisIso3 "${paisRaw}" não encontrado em Pais — campo ignorado (salvo como null).`);
    }

    let quantidade: number;
    try { quantidade = toInt(row.quantidade?.trim(), "quantidade"); }
    catch (e: any) {
      console.warn(`  [aviso] ${e.message} — linha ignorada.`);
      skipped++; continue;
    }

    await prisma.vendaMensal.upsert({
      where:  { produtoId_unidadeVendaId_month_canal: { produtoId, unidadeVendaId, month, canal } },
      create: { produtoId, unidadeVendaId, month, quantidade, receita, canal, paisIso3 },
      update: { quantidade, receita },
    });

    count++;
  }

  console.log(`  ✔ ${count} registros de venda carregados. ${skipped > 0 ? `(${skipped} ignorados)` : ""}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 7 — OrcamentoRun + OrcamentoItem
// ─────────────────────────────────────────────────────────────────────────────

async function loadOrcamento() {
  console.log("[Fase 7] Carregando OrcamentoItem.csv...");
  const rows = parseCsv("OrcamentoItem.csv");

  // Cria OrcamentoRun para cada ano único
  const anos = [...new Set(rows.map((r) => r.ano?.trim()).filter(Boolean))];

  for (const ano of anos) {
    const anoNum = parseInt(ano, 10);
    await prisma.orcamentoRun.upsert({
      where:  { ano: anoNum },
      create: {
        ano:        anoNum,
        status:     "APROVADO",
        aprovadoEm: new Date(`${anoNum - 1}-11-30T00:00:00.000Z`),
        sourceKey:  `CSV-${anoNum}`,
      },
      update: {},
    });
    console.log(`  ✔ OrcamentoRun ${anoNum} criado/confirmado.`);
  }

  const [produtosDb, unidadesDb, paisesDb] = await Promise.all([
    prisma.produto.findMany({ select: { codigo: true } }),
    prisma.unidadeVenda.findMany({ select: { codigo: true } }),
    prisma.pais.findMany({ select: { iso3: true } }),
  ]);
  const produtos = new Set(produtosDb.map((p) => p.codigo));
  const unidades = new Set(unidadesDb.map((u) => u.codigo));
  const paises   = new Set(paisesDb.map((p) => p.iso3));

  let count = 0;
  let skipped = 0;

  for (const row of rows) {
    const anoStr       = row.ano?.trim();
    const produtoId    = row.produtoId?.trim();
    const unidadeVendaId = row.unidadeVendaId?.trim();

    if (!anoStr || !produtoId || !unidadeVendaId) {
      console.warn(`  [aviso] Campos obrigatórios ausentes (ano=${row.ano}, prod=${row.produtoId}, unid=${row.unidadeVendaId}) — linha ignorada.`);
      skipped++; continue;
    }

    if (!produtos.has(produtoId)) {
      console.warn(`  [aviso] produtoId "${produtoId}" não encontrado em Produto — linha ignorada.`);
      skipped++; continue;
    }

    if (!unidades.has(unidadeVendaId)) {
      console.warn(`  [aviso] unidadeVendaId "${unidadeVendaId}" não encontrado em UnidadeVenda — linha ignorada.`);
      skipped++; continue;
    }

    const orcamentoAno = parseInt(anoStr, 10);
    if (isNaN(orcamentoAno)) {
      console.warn(`  [aviso] ano inválido "${anoStr}" — linha ignorada.`);
      skipped++; continue;
    }

    let month: Date;
    try { month = toDate(row.month?.trim()); }
    catch (e: any) {
      console.warn(`  [aviso] Data inválida "${row.month}" — linha ignorada.`);
      skipped++; continue;
    }

    let volumeORC: number;
    try { volumeORC = toInt(row.volumeORC?.trim(), "volumeORC"); }
    catch (e: any) {
      console.warn(`  [aviso] ${e.message} — linha ignorada.`);
      skipped++; continue;
    }

    const paisRaw  = row.paisIso3?.trim() || null;
    const paisIso3 = paisRaw && paises.has(paisRaw) ? paisRaw : null;
    if (paisRaw && !paises.has(paisRaw)) {
      console.warn(`  [aviso] paisIso3 "${paisRaw}" não encontrado em Pais — campo ignorado (salvo como null).`);
    }

    await prisma.orcamentoItem.upsert({
      where:  { orcamentoAno_produtoId_unidadeVendaId_month: { orcamentoAno, produtoId, unidadeVendaId, month } },
      create: { orcamentoAno, produtoId, unidadeVendaId, month, volumeORC, paisIso3 },
      update: { volumeORC },
    });

    count++;
  }

  console.log(`  ✔ ${count} itens de orçamento carregados. ${skipped > 0 ? `(${skipped} ignorados)` : ""}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 8 — ForecastRun + ForecastItem
// ─────────────────────────────────────────────────────────────────────────────

async function loadForecast() {
  console.log("[Fase 8] Carregando ForecastItem.csv...");
  const rows = parseCsv("ForecastItem.csv");

  // Cria ForecastRun para cada refMonth único (ForecastRun mantém UUID como PK)
  const refMonths = [...new Set(rows.map((r) => r.refMonth?.trim()).filter(Boolean))];
  const runMap: Record<string, string> = {}; // refMonth -> runId

  const LEAD_TIME = 2;

  for (const refMonthStr of refMonths) {
    let refDate: Date;
    try { refDate = toDate(refMonthStr); }
    catch (e: any) {
      console.warn(`  [aviso] refMonth inválido "${refMonthStr}" — ciclo ignorado.`);
      continue;
    }

    const windowStart = addMonths(refDate, LEAD_TIME);
    const windowEnd   = addMonths(windowStart, 11);

    let run = await prisma.forecastRun.findFirst({ where: { refMonth: refDate } });
    if (!run) {
      run = await prisma.forecastRun.create({
        data: {
          refMonth:       refDate,
          status:         "SUCCESS",
          windowStart,
          windowEnd,
          leadTimeMonths: LEAD_TIME,
          availableFrom:  null,
          sourceKey:      `CSV-${refMonthStr}`,
        },
      });
      console.log(`  ✔ ForecastRun ${refMonthStr} criado: ${run.id}`);
    } else {
      console.log(`  ℹ ForecastRun ${refMonthStr} já existia: ${run.id}`);
    }

    runMap[refMonthStr] = run.id;
  }

  const adminUser = await prisma.user.findFirst({ where: { perfil: "operador_pcp" } });
  if (!adminUser) {
    console.warn("  [aviso] Nenhum usuário operador_pcp encontrado — ForecastOverrides não serão criados.");
  }

  // Pre-carrega conjuntos de FKs válidas para validação eficiente
  const [produtosDb, unidadesDb] = await Promise.all([
    prisma.produto.findMany({ select: { codigo: true } }),
    prisma.unidadeVenda.findMany({ select: { codigo: true } }),
  ]);
  const produtosSet  = new Set(produtosDb.map((p) => p.codigo));
  const unidadesSet  = new Set(unidadesDb.map((u) => u.codigo));

  let count = 0;
  let overrideCount = 0;
  let skipped = 0;

  for (const row of rows) {
    const runId        = runMap[row.refMonth?.trim()];
    const produtoId    = row.produtoId?.trim();
    const unidadeVendaId = row.unidadeVendaId?.trim();

    if (!runId || !produtoId || !unidadeVendaId) {
      console.warn(`  [aviso] FK não resolvida (ref=${row.refMonth}, prod=${row.produtoId}, unid=${row.unidadeVendaId}) — linha ignorada.`);
      skipped++; continue;
    }

    if (!produtosSet.has(produtoId)) {
      console.warn(`  [aviso] produtoId "${produtoId}" não encontrado em Produto — linha ignorada.`);
      skipped++; continue;
    }

    if (!unidadesSet.has(unidadeVendaId)) {
      console.warn(`  [aviso] unidadeVendaId "${unidadeVendaId}" não encontrada em UnidadeVenda — linha ignorada.`);
      skipped++; continue;
    }

    let month: Date;
    try { month = toDate(row.month?.trim()); }
    catch (e: any) {
      console.warn(`  [aviso] Data inválida "${row.month}" — linha ignorada.`);
      skipped++; continue;
    }

    const volumeIA  = row.volumeIA?.trim()  ? parseInt(row.volumeIA.trim(),  10) : null;
    const paisIso3  = row.paisIso3?.trim()  || null;

    // Prisma não aceita null em chave composta do upsert — usa findFirst + create/update
    let item = await prisma.forecastItem.findFirst({
      where: { runId, produtoId, unidadeVendaId, month, paisIso3 },
    });
    if (item) {
      item = await prisma.forecastItem.update({
        where: { id: item.id },
        data:  { volumeIA },
      });
    } else {
      item = await prisma.forecastItem.create({
        data: { runId, produtoId, unidadeVendaId, month, volumeIA, paisIso3, source: "AIRFLOW", gestorExcluido: false },
      });
    }

    count++;

    // Cria ForecastOverride quando volumeFCTS está preenchido no CSV
    const volumeFCTSRaw = row.volumeFCTS?.trim();
    if (volumeFCTSRaw && adminUser) {
      const volumeFCTS = parseInt(volumeFCTSRaw, 10);
      if (!isNaN(volumeFCTS)) {
        await prisma.forecastOverride.upsert({
          where:  { forecastItemId: item.id },
          create: { forecastItemId: item.id, gestorId: adminUser.id, volumeFCTS },
          update: { volumeFCTS },
        });
        overrideCount++;
      }
    }
  }

  console.log(`  ✔ ${count} itens de forecast carregados. ${overrideCount} overrides criados. ${skipped > 0 ? `(${skipped} ignorados)` : ""}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 9 — DivisionSubmissions para ciclos históricos importados
// ─────────────────────────────────────────────────────────────────────────────

async function loadSubmissions() {
  console.log("[Fase 9] Criando DivisionSubmissions para ciclos históricos...");

  const adminUser = await prisma.user.findFirst({ where: { perfil: "operador_pcp" } });
  if (!adminUser) {
    console.warn("  [aviso] Nenhum usuário operador_pcp encontrado — fase ignorada.");
    return;
  }

  // Carrega todos os runs importados ordenados por refMonth
  const runs = await prisma.forecastRun.findMany({
    where:   { status: "SUCCESS" },
    orderBy: { refMonth: "asc" },
    select:  { id: true, refMonth: true },
  });

  if (runs.length === 0) {
    console.log("  [aviso] Nenhum ForecastRun encontrado — fase ignorada.");
    return;
  }

  // Ciclo mais recente = em preenchimento → DRAFT; demais históricos → APPROVED
  const maxRefMonth = runs[runs.length - 1].refMonth.toISOString();

  let totalCreated = 0;

  for (const run of runs) {
    const isCurrentCycle = run.refMonth.toISOString() === maxRefMonth;
    const status         = isCurrentCycle ? "DRAFT" : "APPROVED";

    // Unidades distintas com ForecastItems neste ciclo
    const units = await prisma.forecastItem.findMany({
      where:    { runId: run.id },
      select:   { unidadeVendaId: true },
      distinct: ["unidadeVendaId"],
    });

    for (const { unidadeVendaId } of units) {
      await prisma.divisionSubmission.upsert({
        where:  { refMonth_unidadeVendaId: { refMonth: run.refMonth, unidadeVendaId } },
        create: {
          unidadeVendaId,
          refMonth:    run.refMonth,
          status,
          autorId:     adminUser.id,
          revisorId:   status === "APPROVED" ? adminUser.id : null,
          submittedAt: status !== "DRAFT"    ? run.refMonth : null,
          reviewedAt:  status === "APPROVED" ? run.refMonth : null,
        },
        update: {},
      });
      totalCreated++;
    }

    console.log(
      `  ✔ ${run.refMonth.toISOString().substring(0, 7)}: ${units.length} unidade(s) → ${status}`
    );
  }

  console.log(`  [ok] ${totalCreated} DivisionSubmissions criadas/verificadas.\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  IMPORTAÇÃO DE DADOS REAIS — seed-import.ts");
  console.log("=".repeat(60));
  console.log(`  Diretório de dados: ${DATA_DIR}\n`);

  // Fase 1: limpar dados fictícios
  await deleteAll();

  // Ler ProdutoUnidadeVenda.csv antecipadamente (usado em fases 2 e 5)
  const puvRows = parseCsv("ProdutoUnidadeVenda.csv");

  // Fase 2: criar UnidadeVenda a partir dos pares únicos do CSV
  await loadUnidades(puvRows);

  // Fase 3: criar Pais (opcional; requerido para vendas de exportação)
  await loadPaises();

  // Fase 4: criar Produtos
  await loadProdutos();

  // Fase 5: criar vínculos Produto × Unidade
  await loadProdutoUnidades(puvRows);

  // Fase 6: carregar vendas históricas
  await loadVendas();

  // Fase 7: carregar orçamento (OrcamentoRun auto-criado por ano)
  await loadOrcamento();

  // Fase 8: carregar forecast (ForecastRun auto-criado por ciclo)
  await loadForecast();

  // Fase 9: criar DivisionSubmissions (APPROVED para ciclos históricos, DRAFT para o atual)
  await loadSubmissions();

  console.log("=".repeat(60));
  console.log("  Importação concluída com sucesso!");
  console.log("  Lembrete: re-vincule os usuários às unidades no painel admin.");
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
