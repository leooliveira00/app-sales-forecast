import prisma from "../config/prisma.js";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import https from "node:https";
import * as SnapshotService from "./snapshot.service.js";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ProtheusItem {
  data:       string;   // "20260101"
  classe:     string;   // unidadeVendaId
  tipo:       "R" | "O";
  produto:    string;
  quantidade: number;
  familia:    string;
}

export interface BackfillOptions {
  dryRun?:   boolean;
  orcAnos?:  number[];
  cicloDe?:  Date;
  cicloAte?: Date;

  // Restringe o escopo do backfill. Se ambos forem vazios/undefined, processa
  // todas as unidades ativas (comportamento legado, exige allowFullBackfill em prod).
  unidadeTipos?:   ("NACIONAL" | "EXPORT")[];
  unidadeCodigos?: string[];

  // Em produção (NODE_ENV=production), executar sem unidadeTipos/unidadeCodigos
  // é bloqueado por padrão. Esta flag autoriza explicitamente o escopo total.
  allowFullBackfill?: boolean;
}

export interface BackfillStats {
  produtoUnidadeVenda: number;
  orcamentoAnos:       number[];
  orcamentoItems:      number;
  forecastRuns:        number;
  forecastItems:       number;
  forecastOverrides:   number;
  submissions:         number;
  csvPath:             string;
}

// "prod|unidade|YYYY-MM-DD" → { iso3 → pct }
type VendasMix = Map<string, Map<string, number>>;

interface MixMaps {
  monthly:      VendasMix; // "prod|unidade|YYYY-MM-DD" → pcts (mix do mês exato)
  previousYear: VendasMix; // "prod|unidade" → pcts (ano anterior, fallback primário)
  aggregate:    VendasMix; // "prod|unidade" → pcts (todo o histórico, fallback secundário)
}

interface DistItem {
  paisIso3:   string | null;
  quantidade: number;
  estimado:   boolean;
}

interface CsvRow {
  tipo:                  string;
  refMonth:              string;
  produtoId:             string;
  unidadeVendaId:        string;
  month:                 string;
  paisIso3:              string;
  volume:                number;
  estimatedDistribution: boolean;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const BACKFILL_KEY = "backfill-protheus";
const BATCH_SIZE   = 300;

// NOV/2023: primeiro ciclo cujo windowStart cobre JAN/2024
const DEFAULT_CICLO_INICIO = new Date("2023-11-01T00:00:00.000Z");
const DEFAULT_CICLO_FIM    = new Date("2026-03-01T00:00:00.000Z");
const DEFAULT_ORC_ANOS     = [2024, 2025, 2026];
const LEADTIME             = 2;   // meses entre refMonth e windowStart
const JANELA               = 12;  // meses cobertos por cada ciclo

// ── Utilitários de data ───────────────────────────────────────────────────────

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n, 1);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

function toFirstOfMonth(yyyymmdd: string): Date {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  return new Date(Date.UTC(y, m, 1));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ── Protheus API ──────────────────────────────────────────────────────────────

function httpsGet(url: string, auth: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search,
        headers: { Authorization: `Basic ${auth}` }, rejectUnauthorized: false },
      res => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode === 404) return resolve("__404__");
          if ((res.statusCode ?? 0) >= 400)
            return reject(new Error(`Protheus HTTP ${res.statusCode}`));
          resolve(Buffer.concat(chunks).toString("utf-8"));
        });
      }
    );
    req.setTimeout(60_000, () => { req.destroy(); reject(new Error("Protheus timeout")); });
    req.on("error", reject);
    req.end();
  });
}

async function fetchPrevisoes(
  cClasse:  string,
  cTipo:    "R" | "O",
  cDataDe:  string,
  cDataAte: string,
  route:    string,
): Promise<ProtheusItem[]> {
  const base = (process.env.PROTHEUS_BASE_URL ?? "").replace(/\/$/, "");
  const user = process.env.PROTHEUS_USER ?? "";
  const pass = process.env.PROTHEUS_PASSWORD ?? "";
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");

  const itens: ProtheusItem[] = [];
  let page = 1;

  while (true) {
    const qs  = new URLSearchParams({ cClasse, cTipo, cDataDe, cDataAte, nPage: String(page) });
    const url = `${base}/${route}/ForecastXProtheus/listaprevisoes?${qs}`;

    const body = await httpsGet(url, auth);
    if (body === "__404__") break;

    const data = JSON.parse(body) as {
      metaDados: { totalPaginas: number };
      itens:     ProtheusItem[];
    };

    itens.push(...(data.itens ?? []));
    console.log(`  [${route}|${cClasse}|${cTipo}] pág ${page}/${data.metaDados?.totalPaginas ?? 1} — ${data.itens?.length ?? 0} itens`);

    if (page >= (data.metaDados?.totalPaginas ?? 1)) break;
    page++;
  }

  return itens;
}

// Consulta todas as rotas configuradas e concatena — cada rota tem produtos distintos
async function fetchPrevisoesAllRoutes(
  cClasse:  string,
  cTipo:    "R" | "O",
  cDataDe:  string,
  cDataAte: string,
): Promise<ProtheusItem[]> {
  const routes = (process.env.PROTHEUS_ROUTES ?? "rest02").split(",").map(r => r.trim()).filter(Boolean);

  const results = await Promise.allSettled(
    routes.map(r => fetchPrevisoes(cClasse, cTipo, cDataDe, cDataAte, r))
  );

  const itens: ProtheusItem[] = [];
  for (const result of results) {
    if (result.status === "rejected") { console.warn(`  WARN rota falhou: ${result.reason}`); continue; }
    itens.push(...result.value);
  }
  return itens;
}

// ── Mix de país via VendaMensal ───────────────────────────────────────────────

async function buildVendasMix(): Promise<MixMaps> {
  const prevYear = new Date().getUTCFullYear() - 1;

  const rows = await prisma.$queryRaw<
    { produto: string; unidade: string; month: string; pais: string; qtd: number }[]
  >`
    SELECT  v."produtoId"      AS produto,
            v."unidadeVendaId" AS unidade,
            TO_CHAR(DATE_TRUNC('month', v.month), 'YYYY-MM-DD') AS month,
            v."paisIso3"       AS pais,
            SUM(v.quantidade)::int AS qtd
    FROM    "VendaMensal" v
    JOIN    "UnidadeVenda" u ON u.codigo = v."unidadeVendaId"
    WHERE   u.tipo = 'EXPORT'
      AND   v."paisIso3" IS NOT NULL
    GROUP   BY v."produtoId", v."unidadeVendaId",
               DATE_TRUNC('month', v.month), v."paisIso3"
  `;

  const rawMonthly    = new Map<string, Map<string, number>>();
  const totsMonthly   = new Map<string, number>();
  const rawPrevYear   = new Map<string, Map<string, number>>();
  const totsPrevYear  = new Map<string, number>();
  const rawAggregate  = new Map<string, Map<string, number>>();
  const totsAggregate = new Map<string, number>();

  for (const row of rows) {
    const rowYear = parseInt(row.month.slice(0, 4), 10);
    const aggKey  = `${row.produto}|${row.unidade}`;

    // Mix mensal exato
    const monthKey = `${aggKey}|${row.month}`;
    if (!rawMonthly.has(monthKey)) rawMonthly.set(monthKey, new Map());
    rawMonthly.get(monthKey)!.set(row.pais, row.qtd);
    totsMonthly.set(monthKey, (totsMonthly.get(monthKey) ?? 0) + row.qtd);

    // Mix do ano anterior
    if (rowYear === prevYear) {
      if (!rawPrevYear.has(aggKey)) rawPrevYear.set(aggKey, new Map());
      const pm = rawPrevYear.get(aggKey)!;
      pm.set(row.pais, (pm.get(row.pais) ?? 0) + row.qtd);
      totsPrevYear.set(aggKey, (totsPrevYear.get(aggKey) ?? 0) + row.qtd);
    }

    // Mix histórico agregado (todos os anos)
    if (!rawAggregate.has(aggKey)) rawAggregate.set(aggKey, new Map());
    const am = rawAggregate.get(aggKey)!;
    am.set(row.pais, (am.get(row.pais) ?? 0) + row.qtd);
    totsAggregate.set(aggKey, (totsAggregate.get(aggKey) ?? 0) + row.qtd);
  }

  function buildProportions(
    raw:  Map<string, Map<string, number>>,
    tots: Map<string, number>,
  ): VendasMix {
    const result: VendasMix = new Map();
    for (const [key, paises] of raw) {
      const total = tots.get(key) ?? 0;
      if (total === 0) continue;
      result.set(key, new Map([...paises].map(([p, q]) => [p, q / total])));
    }
    return result;
  }

  const monthly      = buildProportions(rawMonthly,   totsMonthly);
  const previousYear = buildProportions(rawPrevYear,  totsPrevYear);
  const aggregate    = buildProportions(rawAggregate, totsAggregate);

  console.log(`[backfill] Mix mensal: ${monthly.size} | Ano anterior (${prevYear}): ${previousYear.size} | Agregado: ${aggregate.size}`);

  return { monthly, previousYear, aggregate };
}

// ── Distribuição proporcional por país ────────────────────────────────────────

function distribute(
  qtd:       number,
  prod:      string,
  unidade:   string,
  monthStr:  string,
  tipo:      string,
  mix:       MixMaps,
  paisesOk:  Set<string>,
): DistItem[] {
  if (tipo === "NACIONAL") {
    return [{ paisIso3: null, quantidade: qtd, estimado: false }];
  }

  const aggKey = `${prod}|${unidade}`;
  const pcts   = mix.monthly.get(`${aggKey}|${monthStr}`)
              ?? mix.previousYear.get(aggKey)
              ?? mix.aggregate.get(aggKey);

  if (!pcts) {
    console.warn(`  [distribute] sem mix para ${prod}|${unidade}|${monthStr} → paisIso3=null`);
    return [{ paisIso3: null, quantidade: qtd, estimado: true }];
  }

  const valid   = [...pcts.entries()].filter(([p]) => paisesOk.has(p));
  const result: DistItem[] = [];
  let   alocado = 0;

  valid.forEach(([pais, pct], i) => {
    const vol = i === valid.length - 1
      ? Math.max(0, qtd - alocado)
      : Math.min(Math.round(qtd * pct), Math.max(0, qtd - alocado));
    alocado += vol;
    if (vol > 0) result.push({ paisIso3: pais, quantidade: vol, estimado: true });
  });

  return result.length ? result : [{ paisIso3: null, quantidade: qtd, estimado: true }];
}

// ── Construção de ciclos por unidade ──────────────────────────────────────────

interface CicloData {
  refMonth:    Date;
  windowStart: Date;
  windowEnd:   Date;
}

function buildCycles(revisoes: ProtheusItem[], cicloInicio: Date, cicloFim: Date): CicloData[] {
  if (!revisoes.length) return [];

  const datas = revisoes
    .map(r => toFirstOfMonth(r.data))
    .sort((a, b) => a.getTime() - b.getTime());

  // Primeiro ciclo: data mais antiga da unidade menos o leadtime, nunca antes do limite global
  const rawInicio = addMonths(datas[0], -LEADTIME);
  const inicio    = rawInicio < cicloInicio ? cicloInicio : rawInicio;

  const ciclos: CicloData[] = [];
  let ciclo = new Date(inicio);

  while (ciclo <= cicloFim) {
    const windowStart = addMonths(ciclo, LEADTIME);
    const windowEnd   = addMonths(windowStart, JANELA - 1);
    ciclos.push({ refMonth: new Date(ciclo), windowStart, windowEnd });
    ciclo = addMonths(ciclo, 1);
  }

  return ciclos;
}

// ── CSV de auditoria ──────────────────────────────────────────────────────────

function saveCsv(rows: CsvRow[]): string {
  const dir = join(process.env.UPLOADS_DIR ?? "uploads", "backfill");
  mkdirSync(dir, { recursive: true });

  const ts   = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = join(dir, `backfill_${ts}.csv`);

  const header = "tipo,refMonth,produtoId,unidadeVendaId,month,paisIso3,volume,estimatedDistribution";
  const lines  = rows.map(r =>
    [r.tipo, r.refMonth, r.produtoId, r.unidadeVendaId,
     r.month, r.paisIso3, r.volume, r.estimatedDistribution].join(",")
  );

  writeFileSync(path, [header, ...lines].join("\n"), "utf-8");
  return path;
}

// ── Serviço principal ─────────────────────────────────────────────────────────

export async function runBackfill(options: BackfillOptions = {}): Promise<BackfillStats> {
  const {
    dryRun            = false,
    orcAnos           = DEFAULT_ORC_ANOS,
    cicloDe           = DEFAULT_CICLO_INICIO,
    cicloAte          = DEFAULT_CICLO_FIM,
    unidadeTipos,
    unidadeCodigos,
    allowFullBackfill = false,
  } = options;

  const tiposFiltro    = unidadeTipos?.length    ? unidadeTipos    : undefined;
  const codigosFiltro  = unidadeCodigos?.length  ? unidadeCodigos  : undefined;
  const semFiltro      = !tiposFiltro && !codigosFiltro;

  // Trava de segurança: em produção, exige escopo explícito ou allowFullBackfill.
  // Operações destrutivas (DELETE/upsert) sem filtro podem sobrescrever overrides
  // de gestores e regenerar submissions aprovadas — daí o bloqueio.
  if (semFiltro && process.env.NODE_ENV === "production" && !allowFullBackfill && !dryRun) {
    throw new Error(
      "[backfill] BLOQUEADO: execução em produção sem filtro de unidades. " +
      "Use unidadeTipos / unidadeCodigos (--tipos / --unidades no CLI), " +
      "ou passe allowFullBackfill=true (--all) para autorizar escopo total."
    );
  }

  console.log(`\n[backfill] ── Iniciando ────────────────────────────────────`);
  console.log(`[backfill] dryRun=${dryRun} | ORC=${orcAnos} | ciclos=${fmt(cicloDe)}→${fmt(cicloAte)}`);
  console.log(`[backfill] escopo: tipos=${tiposFiltro?.join(",") ?? "*"} | unidades=${codigosFiltro?.join(",") ?? "*"}\n`);

  // ── Referências do banco ──────────────────────────────────────────────────

  const [unidades, produtos, paises, adminUser, puvExistentes] = await Promise.all([
    prisma.unidadeVenda.findMany({
      where: {
        ativo: true,
        ...(tiposFiltro   ? { tipo:   { in: tiposFiltro } }   : {}),
        ...(codigosFiltro ? { codigo: { in: codigosFiltro } } : {}),
      },
      select: { codigo: true, tipo: true },
    }),
    prisma.produto.findMany({ where: { ativo: true }, select: { codigo: true } }),
    prisma.pais.findMany({ where: { ativo: true }, select: { iso3: true } }),
    prisma.user.findFirst({ where: { perfil: "admin_ti" }, orderBy: { createdAt: "asc" }, select: { id: true } }),
    prisma.$queryRaw<{ codigoFamilia: string; familia: string }[]>`
      SELECT DISTINCT ON ("codigoFamilia") "codigoFamilia", familia
      FROM   "ProdutoUnidadeVenda"
      WHERE  "codigoFamilia" IS NOT NULL AND familia IS NOT NULL
    `,
  ]);

  // codigoFamilia → descrição; usado para enriquecer registros vindos do Protheus
  const familiaDescMap = new Map(
    puvExistentes
      .filter(p => p.codigoFamilia && p.familia)
      .map(p => [p.codigoFamilia!, p.familia!])
  );
  console.log(`[backfill] Famílias com descrição encontradas no banco: ${familiaDescMap.size}`);

  const prodsOk  = new Set(produtos.map(p => p.codigo));
  const paisesOk = new Set(paises.map(p => p.iso3));

  if (unidades.length === 0) {
    throw new Error(
      `[backfill] Nenhuma unidade ativa correspondeu ao filtro ` +
      `(tipos=${tiposFiltro?.join(",") ?? "*"}, unidades=${codigosFiltro?.join(",") ?? "*"}). ` +
      `Verifique os parâmetros antes de executar.`
    );
  }
  console.log(`[backfill] Unidades no escopo: ${unidades.length} (${unidades.map(u => u.codigo).join(", ")})`);

  // Códigos-alvo desta execução — usado nos DELETEs cirúrgicos abaixo
  const unidadesAlvo = unidades.map(u => u.codigo);

  if (!adminUser) console.warn("[backfill] WARN — admin_ti não encontrado; DivisionSubmission será ignorada");

  const mix = await buildVendasMix();

  // ── Acumuladores (IDs gerados aqui para eliminar round-trips ao banco) ────

  const csvRows:     CsvRow[]  = [];
  const puvSet      = new Map<string, { produtoId: string; unidadeVendaId: string; codigoFamilia: string | null; familia: string | null }>();
  const orcAnosSet  = new Set<number>();
  const orcItemRows: {
    orcamentoAno: number; produtoId: string; unidadeVendaId: string;
    month: Date; paisIso3: string | null; volumeORC: number;
  }[] = [];

  // ForecastRun: refKey → { id, janela }.
  // Pré-popula com runs de backfill já existentes no intervalo para reutilizar IDs —
  // assim, ao processar apenas um subconjunto de unidades (ex.: só EXPORT), não
  // criamos runs duplicados nem destruímos os items das demais unidades.
  const fcRunsMap = new Map<string, { id: string; refMonth: Date; windowStart: Date; windowEnd: Date }>();
  const runsBackfillExistentes = await prisma.forecastRun.findMany({
    where: { sourceKey: BACKFILL_KEY, refMonth: { gte: cicloDe, lte: cicloAte } },
    select: { id: true, refMonth: true, windowStart: true, windowEnd: true },
  });
  for (const r of runsBackfillExistentes) {
    if (r.windowStart && r.windowEnd) {
      fcRunsMap.set(fmt(r.refMonth), { id: r.id, refMonth: r.refMonth, windowStart: r.windowStart, windowEnd: r.windowEnd });
    }
  }
  const runsExistentesIds = new Set(runsBackfillExistentes.map(r => r.id));
  console.log(`[backfill] ForecastRuns de backfill já existentes no intervalo: ${runsBackfillExistentes.length} (reutilizados)`);

  const fcItemRows: {
    id: string; runId: string; produtoId: string; unidadeVendaId: string;
    month: Date; paisIso3: string | null;
  }[] = [];

  const fcOvrdRows: { forecastItemId: string; volumeFCTS: number; note: string }[] = [];

  // refKey|unidade → true  (dedup de submissions)
  const subSet = new Map<string, { refMonth: Date; unidadeVendaId: string }>();

  // ── Processar cada unidade ────────────────────────────────────────────────

  for (const { codigo, tipo } of unidades) {
    console.log(`[backfill] → ${codigo} (${tipo})`);

    // Extrai do Protheus em paralelo por tipo
    let revisoes: ProtheusItem[] = [];
    const orcados: Record<number, ProtheusItem[]> = {};

    try {
      // cDataAte: último dia do mês de windowEnd do ciclo mais recente solicitado,
      // garantindo que o Protheus devolva revisões até o último mês da janela.
      const windowEndUlt   = addMonths(cicloAte, LEADTIME + JANELA - 1);
      const fimMesWindow   = new Date(Date.UTC(windowEndUlt.getUTCFullYear(), windowEndUlt.getUTCMonth() + 1, 0));
      const cDataAteWindow = fimMesWindow.toISOString().slice(0, 10).replace(/-/g, "");
      revisoes = await fetchPrevisoesAllRoutes(codigo, "R", "20240101", cDataAteWindow);
    } catch (e) { console.warn(`  WARN R/${codigo}: ${e}`); }

    await Promise.all(
      orcAnos.map(async ano => {
        try {
          const itens = await fetchPrevisoesAllRoutes(codigo, "O", `${ano}0101`, `${ano}1231`);
          if (itens.length) orcados[ano] = itens;
        } catch (e) { console.warn(`  WARN O/${codigo}/${ano}: ${e}`); }
      })
    );

    // ProdutoUnidadeVenda: família única por produto desta unidade
    for (const item of [...revisoes, ...Object.values(orcados).flat()]) {
      const key = `${item.produto}|${codigo}`;
      if (prodsOk.has(item.produto) && !puvSet.has(key)) {
        const codFamilia = item.familia ?? null;
        puvSet.set(key, {
          produtoId:     item.produto,
          unidadeVendaId: codigo,
          codigoFamilia: codFamilia,
          familia:       codFamilia ? (familiaDescMap.get(codFamilia) ?? null) : null,
        });
      }
    }

    // OrcamentoItem: substituição total por (ano, unidade) — Protheus é fonte da verdade
    // Map local por unidade: agrega V+D do Protheus (mesma chave natural) antes de empilhar
    const orcItemMapLocal = new Map<string, typeof orcItemRows[0]>();

    for (const [anoStr, itens] of Object.entries(orcados)) {
      const ano = Number(anoStr);
      orcAnosSet.add(ano);

      for (const item of itens) {
        const qtd = Math.round(item.quantidade);
        if (!prodsOk.has(item.produto) || qtd <= 0) continue;

        const month    = toFirstOfMonth(item.data);
        const monthStr = fmt(month);

        for (const d of distribute(qtd, item.produto, codigo, monthStr, tipo, mix, paisesOk)) {
          const k = `${ano}|${item.produto}|${codigo}|${monthStr}|${d.paisIso3 ?? ""}`;
          if (orcItemMapLocal.has(k)) {
            orcItemMapLocal.get(k)!.volumeORC += d.quantidade;
          } else {
            orcItemMapLocal.set(k, { orcamentoAno: ano, produtoId: item.produto, unidadeVendaId: codigo, month, paisIso3: d.paisIso3, volumeORC: d.quantidade });
          }
          csvRows.push({ tipo: "ORCADO", refMonth: String(ano), produtoId: item.produto, unidadeVendaId: codigo, month: monthStr, paisIso3: d.paisIso3 ?? "", volume: d.quantidade, estimatedDistribution: d.estimado });
        }
      }
    }
    orcItemRows.push(...orcItemMapLocal.values());

    // Ciclos de Forecast: janela dinâmica baseada nos dados disponíveis da unidade
    if (!revisoes.length) { console.log(`  sem revisões — ciclos pulados`); continue; }

    // Agrupa por mês → lista de produtos (chave só por mês sobrescreveria produtos distintos)
    const revPorMes = new Map<string, ProtheusItem[]>();
    for (const r of revisoes) {
      const mesStr = fmt(toFirstOfMonth(r.data));
      if (!revPorMes.has(mesStr)) revPorMes.set(mesStr, []);
      revPorMes.get(mesStr)!.push(r);
    }

    const ciclos = buildCycles(revisoes, cicloDe, cicloAte);

    for (const { refMonth, windowStart, windowEnd } of ciclos) {
      const refKey = fmt(refMonth);

      // ForecastRun: ID gerado uma vez, compartilhado por todas as unidades do mesmo ciclo
      if (!fcRunsMap.has(refKey)) {
        fcRunsMap.set(refKey, { id: randomUUID(), refMonth, windowStart, windowEnd });
      }
      const runId    = fcRunsMap.get(refKey)!.id;
      let   temItem  = false;

      // ForecastItem + ForecastOverride por mês da janela
      let mes = new Date(windowStart);
      while (mes <= windowEnd) {
        const mesStr     = fmt(mes);
        const revisoesMes = revPorMes.get(mesStr) ?? [];

        for (const rev of revisoesMes) {
          const qtdRev = Math.round(rev.quantidade);
          if (!prodsOk.has(rev.produto) || qtdRev <= 0) continue;

          for (const d of distribute(qtdRev, rev.produto, codigo, mesStr, tipo, mix, paisesOk)) {
            const itemId = randomUUID();
            fcItemRows.push({ id: itemId, runId, produtoId: rev.produto, unidadeVendaId: codigo, month: new Date(mes), paisIso3: d.paisIso3 });
            fcOvrdRows.push({ forecastItemId: itemId, volumeFCTS: d.quantidade, note: "Backfill Protheus — última revisão disponível" });
            csvRows.push({ tipo: "FORECAST", refMonth: refKey, produtoId: rev.produto, unidadeVendaId: codigo, month: mesStr, paisIso3: d.paisIso3 ?? "", volume: d.quantidade, estimatedDistribution: d.estimado });
            temItem = true;
          }
        }

        mes = addMonths(mes, 1);
      }

      if (temItem && adminUser) {
        const subKey = `${refKey}|${codigo}`;
        if (!subSet.has(subKey)) subSet.set(subKey, { refMonth, unidadeVendaId: codigo });
      }
    }

    const primeiroRunId = ciclos[0] ? (fcRunsMap.get(fmt(ciclos[0].refMonth))?.id ?? "") : "";
    console.log(`  ciclos=${ciclos.length} | items=${fcItemRows.filter(r => r.runId === primeiroRunId).length}`);
  }

  // ── Resumo ────────────────────────────────────────────────────────────────

  const stats = {
    produtoUnidadeVenda: puvSet.size,
    orcamentoAnos:       [...orcAnosSet].sort((a, b) => a - b),
    orcamentoItems:      orcItemRows.length,
    forecastRuns:        fcRunsMap.size,
    forecastItems:       fcItemRows.length,
    forecastOverrides:   fcOvrdRows.length,
    submissions:         subSet.size,
    csvPath:             "",
  };

  console.log(`\n[backfill] ── Resumo ───────────────────────────────────────`);
  console.log(`  ProdutoUnidadeVenda : ${stats.produtoUnidadeVenda}`);
  console.log(`  OrcamentoRun       : ${stats.orcamentoAnos}`);
  console.log(`  OrcamentoItem      : ${stats.orcamentoItems}`);
  console.log(`  ForecastRun        : ${stats.forecastRuns} ciclos`);
  console.log(`  ForecastItem       : ${stats.forecastItems}`);
  console.log(`  ForecastOverride   : ${stats.forecastOverrides}`);
  console.log(`  DivisionSubmission : ${stats.submissions}`);
  console.log(`───────────────────────────────────────────────────────────\n`);

  const csvPath = saveCsv(csvRows);
  stats.csvPath = csvPath;
  console.log(`[backfill] CSV salvo em ${csvPath}`);

  if (dryRun) {
    console.log("[backfill] DRY RUN — nenhuma escrita realizada.");
    return stats;
  }

  // ── Escrita no banco ──────────────────────────────────────────────────────

  // 1. ProdutoUnidadeVenda — cria o vínculo (produto com forecast numa unidade ainda
  //    não cadastrada) somente quando ele não existir. Se já existir, NÃO reescreve a
  //    classificação: codigoFamilia/familia/divisao são de responsabilidade exclusiva do
  //    produtos_sync (cadastro mestre). Regravar aqui o valor por-classe do listaprevisoes
  //    corromperia a família (ex.: 0365 → 0315 conforme a classe da revisão).
  const puvRows = [...puvSet.values()];
  for (let i = 0; i < puvRows.length; i += BATCH_SIZE) {
    await prisma.$transaction(
      puvRows.slice(i, i + BATCH_SIZE).map(row =>
        prisma.produtoUnidadeVenda.upsert({
          where:  { produtoId_unidadeVendaId: { produtoId: row.produtoId, unidadeVendaId: row.unidadeVendaId } },
          create: { ...row, ativo: true },
          update: {},
        })
      )
    );
  }
  console.log(`[load] ProdutoUnidadeVenda: ${puvRows.length}`);

  // 2. OrcamentoRun — cria se não existir (status = APROVADO)
  for (const ano of orcAnosSet) {
    await prisma.orcamentoRun.upsert({
      where:  { ano },
      create: { ano, status: "APROVADO" },
      update: {},
    });
  }
  console.log(`[load] OrcamentoRun: ${[...orcAnosSet].sort()}`);

  // 3. OrcamentoItem — DELETE + INSERT por (ano, unidade): substitui dados incorretos
  //    Sem @@unique composto no schema (usa partial indexes), então upsert não é possível.
  const unidadesComOrc = [...new Set(orcItemRows.map(r => r.unidadeVendaId))];
  if (unidadesComOrc.length) {
    await prisma.orcamentoItem.deleteMany({
      where: { orcamentoAno: { in: [...orcAnosSet] }, unidadeVendaId: { in: unidadesComOrc } },
    });
    for (let i = 0; i < orcItemRows.length; i += BATCH_SIZE) {
      await prisma.orcamentoItem.createMany({ data: orcItemRows.slice(i, i + BATCH_SIZE) });
    }
  }
  console.log(`[load] OrcamentoItem: ${orcItemRows.length}`);

  // 4. ForecastRun + ForecastItem — estratégia cirúrgica por unidade:
  //    a) Apaga apenas ForecastItems das unidades-alvo dentro de runs de backfill no intervalo
  //       (cascade leva ForecastOverride junto). Items de outras unidades nesses runs permanecem.
  //    b) Cria apenas os ForecastRuns novos (refMonths que ainda não existiam como backfill).
  //       Runs reutilizados mantêm seu ID, createdAt e sourceKey originais.
  //    c) Limpa runs de backfill órfãos (sem nenhum item) ao final.
  //    Runs do Airflow (sourceKey != BACKFILL_KEY) nunca são tocados.
  const itemsApagados = await prisma.forecastItem.deleteMany({
    where: {
      unidadeVendaId: { in: unidadesAlvo },
      run: { sourceKey: BACKFILL_KEY, refMonth: { gte: cicloDe, lte: cicloAte } },
    },
  });
  console.log(`[load] ForecastItem (apagados das unidades-alvo): ${itemsApagados.count}`);

  const runsNovos = [...fcRunsMap.values()].filter(r => !runsExistentesIds.has(r.id));
  if (runsNovos.length) {
    await prisma.forecastRun.createMany({
      data: runsNovos.map(r => ({
        id:             r.id,
        refMonth:       r.refMonth,
        executedAt:     r.refMonth,
        status:         "SUCCESS",
        windowStart:    r.windowStart,
        windowEnd:      r.windowEnd,
        leadTimeMonths: LEADTIME,
        sourceKey:      BACKFILL_KEY,
      })),
    });
  }
  console.log(`[load] ForecastRun: ${runsNovos.length} novos | ${runsExistentesIds.size} reutilizados`);

  // 5. ForecastItem — IDs pré-gerados, createMany direto (runs recém-criados, sem conflito)
  for (let i = 0; i < fcItemRows.length; i += BATCH_SIZE) {
    await prisma.forecastItem.createMany({
      data: fcItemRows.slice(i, i + BATCH_SIZE).map(r => ({
        id:             r.id,
        runId:          r.runId,
        produtoId:      r.produtoId,
        unidadeVendaId: r.unidadeVendaId,
        month:          r.month,
        paisIso3:       r.paisIso3 ?? undefined,
        volumeIA:       null,
        source:         "SYSTEM",
        gestorExcluido: false,
      })),
    });
  }
  console.log(`[load] ForecastItem: ${fcItemRows.length}`);

  // 6. ForecastOverride — IDs dos itens já conhecidos, upsert por forecastItemId
  for (let i = 0; i < fcOvrdRows.length; i += BATCH_SIZE) {
    await prisma.$transaction(
      fcOvrdRows.slice(i, i + BATCH_SIZE).map(r =>
        prisma.forecastOverride.upsert({
          where:  { forecastItemId: r.forecastItemId },
          create: r,
          update: { volumeFCTS: r.volumeFCTS },
        })
      )
    );
  }
  console.log(`[load] ForecastOverride: ${fcOvrdRows.length}`);

  // 7. DivisionSubmission — INSERT apenas se não existir (não sobrescreve aprovações reais)
  if (adminUser) {
    for (const sub of subSet.values()) {
      await prisma.divisionSubmission.upsert({
        where:  { refMonth_unidadeVendaId: { refMonth: sub.refMonth, unidadeVendaId: sub.unidadeVendaId } },
        create: {
          refMonth:       sub.refMonth,
          unidadeVendaId: sub.unidadeVendaId,
          status:         "APPROVED",
          autorId:        adminUser.id,
          revisorId:      adminUser.id,
          submittedAt:    sub.refMonth,
          reviewedAt:     sub.refMonth,
        },
        update: {},
      });
    }
  }
  console.log(`[load] DivisionSubmission: ${subSet.size}`);

  // 7b. Limpeza de ForecastRuns de backfill órfãos (sem nenhum item) no intervalo.
  //     Pode acontecer quando o escopo desta execução excluiu unidades que antes
  //     eram as únicas presentes em algum run, ou após mudanças de portfólio.
  const runsOrfaos = await prisma.forecastRun.deleteMany({
    where: {
      sourceKey: BACKFILL_KEY,
      refMonth:  { gte: cicloDe, lte: cicloAte },
      items:     { none: {} },
    },
  });
  if (runsOrfaos.count) console.log(`[load] ForecastRun órfãos removidos: ${runsOrfaos.count}`);

  // 8. Snapshots — recomputa todos os anos com OrcamentoRun
  console.log("[backfill] Recomputando snapshots...");
  for (const ano of [...orcAnosSet].sort()) {
    await SnapshotService.refreshConsolidadoSnapshot(ano);
  }
  await SnapshotService.refreshAcuraciaSnapshot({});
  console.log("[backfill] ✓ Snapshots recomputados");

  console.log("\n[backfill] ✓ Concluído com sucesso\n");
  return stats;
}
