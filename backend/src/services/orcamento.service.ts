import { OrcamentoStatus } from "@prisma/client";
import prisma from "../config/prisma.js";
import { appCache } from "../utils/cache.js";
import * as SnapshotService from "./snapshot.service.js";
import { winningRunByUnitMonth, type ForecastRunMeta } from "../utils/forecast-cycle.js";

/** Snapshots mais antigos que este valor são considerados stale — cai no fallback de query ao vivo. */
const SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000; // 24 horas

// ── Desvio FCST × Vendas Ano Anterior (A.A.) ───────────────────────────────
//
// Replica a lógica do Meu Forecast (MeuForecastPage.adaptProduct): o desvio
// compara o FCST com a venda do MESMO período do ano anterior, aplicando um
// FILTRO SIMÉTRICO MENSAL — só entram os meses em que houve venda A.A. (> 0),
// e o FCST do desvio soma apenas esses mesmos meses. Meses sem A.A. são
// ignorados dos dois lados para não inflar o desvio.

interface DesvioAA { vendaAA: number; fctsForDesvio: number }

/**
 * Busca a venda do ano anterior por (produtoId → mês-corrente → qtd), para a
 * janela [startMonth, endMonth] deslocada 1 ano atrás. O mês retornado já é o
 * mês CORRENTE equivalente (mês do A.A. + 1 ano), para casar com o FCST atual.
 */
async function fetchVendaAAByProdMonth(
  unidadeVendaId: string, startMonth: string, endMonth: string, paisIso3?: string | null,
): Promise<Map<string, Map<string, number>>> {
  const gte = new Date(`${startMonth}-01T00:00:00Z`);
  gte.setUTCFullYear(gte.getUTCFullYear() - 1);
  const lt = new Date(`${endMonth}-01T00:00:00Z`);
  lt.setUTCMonth(lt.getUTCMonth() + 1);           // primeiro dia do mês seguinte ao endMonth
  lt.setUTCFullYear(lt.getUTCFullYear() - 1);      // -1 ano

  const rows = await prisma.vendaMensal.findMany({
    where:  { unidadeVendaId, month: { gte, lt }, ...(paisIso3 != null ? { paisIso3 } : {}) },
    select: { produtoId: true, month: true, quantidade: true },
  });

  const map = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const cur = new Date(r.month);
    cur.setUTCFullYear(cur.getUTCFullYear() + 1);  // desloca para o mês corrente equivalente
    const mk = cur.toISOString().substring(0, 7);
    if (!map.has(r.produtoId)) map.set(r.produtoId, new Map());
    const m = map.get(r.produtoId)!;
    m.set(mk, (m.get(mk) ?? 0) + r.quantidade);
  }
  return map;
}

/**
 * Aplica o filtro simétrico: por produto, soma vendaAA e o FCST dos meses com
 * venda A.A. > 0. Produtos sem nenhum mês A.A. não entram (desvio indefinido).
 */
function computeDesvioAAPorProduto(
  fctsByProdMonth:    Map<string, Map<string, number>>,
  vendaAAByProdMonth: Map<string, Map<string, number>>,
): Map<string, DesvioAA> {
  const out = new Map<string, DesvioAA>();
  for (const [prod, mMap] of vendaAAByProdMonth) {
    let vendaAA = 0, fctsForDesvio = 0;
    for (const [mk, aa] of mMap) {
      if (aa > 0) {
        vendaAA       += aa;
        fctsForDesvio += fctsByProdMonth.get(prod)?.get(mk) ?? 0;
      }
    }
    if (vendaAA > 0) out.set(prod, { vendaAA, fctsForDesvio });
  }
  return out;
}

/**
 * Desvio FCST × Vendas A.A. agregado por UNIDADE, com o mesmo filtro simétrico
 * mensal, mas computado no banco a partir da grain do snapshot (produto×mês)
 * cruzada com a venda do ano anterior. Retorna ~1 linha por unidade.
 * Usado pela tabela principal do consolidado (divisões colapsadas).
 */
async function fetchDesvioAAByUnitFromSnapshot(gte: Date, lt: Date): Promise<Map<string, DesvioAA>> {
  const priorGte = new Date(gte); priorGte.setUTCFullYear(priorGte.getUTCFullYear() - 1);
  const priorLt  = new Date(lt);  priorLt.setUTCFullYear(priorLt.getUTCFullYear() - 1);

  // Consistência com getConsolidadoUnidade (visão expandida): considera apenas
  // produtos que TÊM linha no snapshot do período (portfólio atual). Para esses,
  // vendaAA = soma de toda a venda A.A. (meses com venda > 0) e fctsForDesvio = FCST
  // do snapshot dos mesmos meses (0 quando o mês não tem linha). Produtos vendidos no
  // A.A. mas fora do portfólio atual não entram (também não aparecem no breakdown).
  const rows = await prisma.$queryRaw<{ unidade: string; vendaAA: number; fctsForDesvio: number }[]>`
    WITH snapprod AS (
      SELECT DISTINCT "unidadeVendaId" AS uni, "produtoId" AS prod
      FROM   "ConsolidadoProdutoMesSnapshot"
      WHERE  "refMonth" >= ${gte} AND "refMonth" < ${lt}
    ),
    snap AS (
      SELECT "unidadeVendaId" AS uni, "produtoId" AS prod, "refMonth" AS mes, SUM(fcts) AS fcts
      FROM   "ConsolidadoProdutoMesSnapshot"
      WHERE  "refMonth" >= ${gte} AND "refMonth" < ${lt}
      GROUP  BY 1, 2, 3
    ),
    prior AS (
      SELECT vm."unidadeVendaId" AS uni, vm."produtoId" AS prod,
             (date_trunc('month', vm.month) + interval '1 year') AS curmonth,
             SUM(vm.quantidade) AS qtd
      FROM   "VendaMensal" vm
      WHERE  vm.month >= ${priorGte} AND vm.month < ${priorLt}
      GROUP  BY 1, 2, 3
      HAVING SUM(vm.quantidade) > 0
    )
    SELECT p.uni                            AS unidade,
           SUM(p.qtd)::float8               AS "vendaAA",
           SUM(COALESCE(sn.fcts, 0))::float8 AS "fctsForDesvio"
    FROM   prior p
    JOIN   snapprod sp ON sp.uni = p.uni AND sp.prod = p.prod
    LEFT JOIN snap sn  ON sn.uni = p.uni AND sn.prod = p.prod AND sn.mes = p.curmonth
    GROUP  BY p.uni
  `;

  const map = new Map<string, DesvioAA>();
  for (const r of rows) map.set(r.unidade, { vendaAA: Number(r.vendaAA), fctsForDesvio: Number(r.fctsForDesvio) });
  return map;
}

// ── CRUD de OrcamentoRun ───────────────────────────────────────────────────

export const listRuns = async () =>
  prisma.orcamentoRun.findMany({
    orderBy: { ano: "desc" },
    include: { _count: { select: { items: true } } },
  });

export const findRunByAno = async (ano: number) =>
  prisma.orcamentoRun.findUnique({ where: { ano } });

export const createRun = async (data: {
  ano: number;
  aprovadoEm?: string;
  status?: OrcamentoStatus;
  sourceKey?: string;
}) =>
  prisma.orcamentoRun.create({
    data: {
      ano: data.ano,
      aprovadoEm: data.aprovadoEm ? new Date(data.aprovadoEm) : null,
      status: data.status ?? "APROVADO",
      sourceKey: data.sourceKey ?? null,
    },
  });

export const upsertItems = async (
  orcamentoAno: number,
  items: Array<{
    produtoId: string;
    unidadeVendaId: string;
    month: string;
    volumeORC: number;
  }>
) =>
  prisma.$transaction(async (tx) => {
    // OrcamentoItem não tem @@unique composto (paisIso3 usa índices parciais,
    // ver schema.prisma) — Prisma não gera um WhereUniqueInput para essa combinação,
    // então usamos findFirst + create/update em vez de upsert.
    const results = [];
    for (const item of items) {
      const month = new Date(item.month);
      const existing = await tx.orcamentoItem.findFirst({
        where: {
          orcamentoAno,
          produtoId: item.produtoId,
          unidadeVendaId: item.unidadeVendaId,
          month,
          paisIso3: null,
        },
        select: { id: true },
      });

      const result = existing
        ? await tx.orcamentoItem.update({
            where: { id: existing.id },
            data: { volumeORC: item.volumeORC },
          })
        : await tx.orcamentoItem.create({
            data: {
              orcamentoAno,
              produtoId: item.produtoId,
              unidadeVendaId: item.unidadeVendaId,
              month,
              volumeORC: item.volumeORC,
            },
          });
      results.push(result);
    }
    return results;
  });

// ── Consolidado (endpoint principal do ConsolidadoPage) ────────────────────

/**
 * Retorna os dados consolidados para a janela [startMonth, endMonth].
 * startMonth e endMonth são strings "YYYY-MM" (ex: "2025-05", "2026-04").
 *
 * Para retrocompatibilidade, o controller pode converter ?ano=YYYY em
 * startMonth=YYYY-01 / endMonth=YYYY-12 antes de chamar esta função.
 */
export const getConsolidado = async (
  startMonth: string,
  endMonth: string,
  lightweight = false,
) => {
  const cacheKey = `consolidado|${startMonth}|${endMonth}|${lightweight ? 'leve' : 'full'}`;
  const cached = appCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  // ── Tenta servir do snapshot pré-computado ─────────────────────────────────
  {
    const anoGteSnap = new Date(`${startMonth}-01T00:00:00Z`);
    const anoLtSnap  = new Date(`${endMonth}-01T00:00:00Z`);
    anoLtSnap.setUTCMonth(anoLtSnap.getUTCMonth() + 1);

    const snapRows = await prisma.consolidadoMesSnapshot.findMany({
      where: { refMonth: { gte: anoGteSnap, lt: anoLtSnap } },
    });

    if (snapRows.length > 0) {
      const oldestAllowed = Date.now() - SNAPSHOT_STALE_MS;
      const isFresh = snapRows.every(r => r.computedAt.getTime() > oldestAllowed);

      // Stale-while-revalidate: serve do snapshot mesmo se stale, dispara refresh em background
      // apenas para o ano corrente — anos históricos não geram carga automática, pois seus
      // dados raramente mudam; o refresh ocorre via hooks de escrita (aprovações, overrides).
      if (!isFresh) {
        const endYearSnap = parseInt(endMonth.substring(0, 4), 10);
        const currentYear = new Date().getUTCFullYear();
        if (endYearSnap >= currentYear) {
          void SnapshotService.refreshConsolidadoSnapshot(endYearSnap)
            .catch(err => console.error('[snapshot] bg-refresh (getConsolidado) failed:', err));
        }
      }

      const endYearSnap   = parseInt(endMonth.substring(0, 4), 10);
      const startYearSnap = parseInt(startMonth.substring(0, 4), 10);

      const [run, unitDescs, desvioAAByUnit] = await Promise.all([
        prisma.orcamentoRun.findFirst({ where: { ano: endYearSnap, status: "APROVADO" } }),
        prisma.unidadeVenda.findMany({ select: { codigo: true, descricao: true, tipo: true } }),
        fetchDesvioAAByUnitFromSnapshot(anoGteSnap, anoLtSnap),
      ]);

      const unitDescMap = new Map(unitDescs.map(u => [u.codigo, u.descricao]));
      const unitTipoMap = new Map(unitDescs.map(u => [u.codigo, u.tipo as string]));

      // Meses globais
      const mesByMonth = new Map<string, { orc: number; fcts: number; vendas: number }>();
      const unitRowsMap = new Map<string, typeof snapRows>();

      for (const s of snapRows) {
        const mk = s.refMonth.toISOString().substring(0, 7);
        if (!mesByMonth.has(mk)) mesByMonth.set(mk, { orc: 0, fcts: 0, vendas: 0 });
        const m = mesByMonth.get(mk)!;
        m.orc += s.orc; m.fcts += s.fcts; m.vendas += s.vendas;

        if (!unitRowsMap.has(s.unidadeVendaId)) unitRowsMap.set(s.unidadeVendaId, []);
        unitRowsMap.get(s.unidadeVendaId)!.push(s);
      }

      const allMonthKeys: string[] = [];
      const cur = new Date(`${startMonth}-01`);
      const end = new Date(`${endMonth}-01`);
      while (cur <= end) {
        allMonthKeys.push(cur.toISOString().substring(0, 7));
        cur.setMonth(cur.getMonth() + 1);
      }

      const meses = allMonthKeys.map(mk => ({
        month: `${mk}-01`,
        ...(mesByMonth.get(mk) ?? { orc: 0, fcts: 0, vendas: 0 }),
      }));

      const unidades = Array.from(unitRowsMap.entries()).map(([codigo, rows]) => {
        const rowByMk = new Map(rows.map(r => [r.refMonth.toISOString().substring(0, 7), r]));
        const porMes = allMonthKeys.map(mk => {
          const snap = rowByMk.get(mk);
          return {
            month:            `${mk}-01`,
            orc:              snap?.orc   ?? 0,
            fcts:             snap?.fcts  ?? 0,
            vendas:           snap?.vendas ?? 0,
            submissionStatus: (snap?.submissaoStatus ?? null) as string | null,
          };
        });
        const orcAnual    = porMes.reduce((s, m) => s + m.orc,    0);
        const fctsAnual   = porMes.reduce((s, m) => s + m.fcts,   0);
        const vendasAnual = porMes.reduce((s, m) => s + m.vendas, 0);
        // Δ Ciclo Ant.: soma das colunas pré-computadas no snapshot. Estas já foram
        // gravadas apenas nos meses da interseção das janelas dos dois ciclos (ver
        // snapshot.service), então a soma na janela não sofre o artefato de mês deslocado.
        const latestCycleFcts = rows.reduce((s, r) => s + r.latestRunFcts, 0);
        const prevCycleFcts   = rows.reduce((s, r) => s + r.prevRunFcts,   0);
        const latestStatus = [...porMes].reverse().find(m => m.submissionStatus)?.submissionStatus ?? null;
        return {
          codigo,
          descricao:       unitDescMap.get(codigo) ?? "",
          tipo:            unitTipoMap.get(codigo) ?? "NACIONAL",
          orcAnual,
          fctsAnual,
          vendasAnual,
          submissaoStatus: latestStatus,
          latestCycleFcts,
          prevCycleFcts,
          vendaAA:       desvioAAByUnit.get(codigo)?.vendaAA       ?? null,
          fctsForDesvio: desvioAAByUnit.get(codigo)?.fctsForDesvio ?? null,
          porMes,
          produtos:        [] as object[],
          familiaMeses:    [] as object[],
        };
      });

      const result = { run, meses, unidades, crossYear: startYearSnap !== endYearSnap };
      appCache.set(cacheKey, result, 5 * 60 * 1000);
      return result;
    }
  }
  // ── Fim do bloco de snapshot — snapRows.length === 0, executa query ao vivo ─

  // Determinar o ano dominante da janela para buscar o OrcamentoRun.
  // Usa o ano do endMonth — assim uma janela Mai/2025–Abr/2026 usa o ORC de 2026.
  const endYear = parseInt(endMonth.substring(0, 4), 10);

  // 1. OrcamentoRun do ano dominante (pode ser de dois anos distintos na janela)
  const run = await prisma.orcamentoRun.findFirst({
    where: { ano: endYear, status: "APROVADO" },
  });

  if (!run) {
    appCache.set(cacheKey, { run: null, meses: [], unidades: [], crossYear: false }, 2 * 60 * 1000);
    return { run: null, meses: [], unidades: [], crossYear: false };
  }

  const anoGte = new Date(`${startMonth}-01`);
  // endMonth é inclusivo: gte start e lt primeiro dia do mês seguinte
  const endDate = new Date(`${endMonth}-01`);
  endDate.setMonth(endDate.getMonth() + 1);
  const anoLt  = endDate;

  // Sinaliza ao frontend quando a janela engloba dois anos de OrcamentoRun distintos
  const startYear = parseInt(startMonth.substring(0, 4), 10);
  const crossYear = startYear !== endYear;

  // 2 + 3a + 5 em paralelo — queries independentes entre si.
  // ATENÇÃO: approvedSubs NÃO tem filtro de ano propositalmente — um ForecastRun de
  // refMonth anterior ao ano selecionado pode ter ForecastItems dentro do ano
  // (devido ao leadTimeMonths). Filtrar por ano zeraria esse FCTS incorretamente.
  // Limita os OrcamentoItems aos anos de orçamento relevantes para a janela.
  // Para uma janela same-year (ex: 2026-01 a 2026-12) filtra só orcamentoAno=2026.
  // Para cross-year (ex: 2025-05 a 2026-04) inclui ambos (2025, 2026).
  // Isso evita somar itens de runs de anos diferentes que tenham meses coincidentes.
  const orcAnosNeeded = crossYear ? [startYear, endYear] : [endYear];

  const [orcItems, approvedSubs, vendas, submissions] = await Promise.all([
    // 2. OrcamentoItems da janela selecionada, filtrados por mês E por orcamentoAno.
    prisma.orcamentoItem.findMany({
      where: {
        month:        { gte: anoGte, lt: anoLt },
        orcamentoAno: { in: orcAnosNeeded },
      },
      include: {
        produto: {
          select: {
            codigo: true,
            descricao: true,
            unidades: { select: { unidadeVendaId: true, familia: true } },
          },
        },
        unidadeVenda: { select: { codigo: true, descricao: true, tipo: true } },
      },
    }),
    // 3a. Submissões aprovadas (SEM filtro de ano — veja comentário acima)
    prisma.divisionSubmission.findMany({
      where:  { status: "APPROVED" },
      select: { unidadeVendaId: true, refMonth: true },
    }),
    // 4. VendaMensal do ano
    prisma.vendaMensal.findMany({
      where: { month: { gte: anoGte, lt: anoLt } },
      select: { produtoId: true, unidadeVendaId: true, month: true, quantidade: true },
    }),
    // 5. DivisionSubmissions do ano (com filtro de ano — apenas para exibir badge de status)
    prisma.divisionSubmission.findMany({
      where: { refMonth: { gte: anoGte, lt: anoLt } },
      select: { unidadeVendaId: true, refMonth: true, status: true },
    }),
  ]);

  // 3. FCTS por mês alvo dentro do ano seleccionado.
  //    Apenas ciclos com DivisionSubmission APPROVED entram no consolidado —
  //    ciclos abertos (sem aprovação) não devem sobrescrever valores homologados.

  const approvedRefMonths = [...new Set(approvedSubs.map((s) => s.refMonth.toISOString()))];

  const approvedRuns = approvedRefMonths.length > 0
    ? await prisma.forecastRun.findMany({
        where:  { refMonth: { in: approvedRefMonths.map((m) => new Date(m)) }, status: "SUCCESS" },
        select: { id: true, refMonth: true, executedAt: true, windowStart: true, windowEnd: true },
      })
    : [];

  const runByRefMonth = new Map<string, string>(
    approvedRuns.map((r) => [r.refMonth.toISOString(), r.id])
  );

  // unidadeVendaId → Set<runId> dos ciclos que foram aprovados para aquela unidade
  const approvedRunsByUnit = new Map<string, Set<string>>();
  for (const sub of approvedSubs) {
    const runId = runByRefMonth.get(sub.refMonth.toISOString());
    if (!runId) continue;
    if (!approvedRunsByUnit.has(sub.unidadeVendaId))
      approvedRunsByUnit.set(sub.unidadeVendaId, new Set());
    approvedRunsByUnit.get(sub.unidadeVendaId)!.add(runId);
  }

  const approvedRunIds = approvedRuns.map((r) => r.id);

  // 3b. Busca ForecastItems filtrando por runId aprovado.
  // Sem filtro de paisIso3: para unidades EXPORT os itens são por país (paisIso3 != null);
  // para unidades NACIONAL existe um único item com paisIso3 = null.
  // A agregação em fctsByKey soma todos os países de um mesmo produto×unidade×mês.
  const allForecastItems = await prisma.forecastItem.findMany({
    where: {
      month:          { gte: anoGte, lt: anoLt },
      runId:          { in: approvedRunIds },
      gestorExcluido: false,
    },
    include: {
      overrides: { take: 1, orderBy: { updatedAt: "desc" } },
      produto:   { select: { codigo: true, descricao: true, classe: true,
                             unidades: { select: { unidadeVendaId: true, familia: true } } } },
    },
  });

  // Ciclo vencedor por (unidade, mês): último ciclo aprovado cuja janela cobre o mês.
  // Substitui a catraca "último run que tinha o produto" — ver utils/forecast-cycle.ts.
  const runMetaById = new Map<string, ForecastRunMeta>(approvedRuns.map(r => [r.id, r]));
  const winningRun  = winningRunByUnitMonth(approvedRunsByUnit, runMetaById);

  // Mapa: "produtoId|unidadeVendaId|YYYY-MM" → volumeFCTS do ciclo vencedor
  const fctsByKey = new Map<string, number>();
  for (const item of allForecastItems) {
    const mk = item.month.toISOString().substring(0, 7);
    if (item.runId !== winningRun.get(`${item.unidadeVendaId}|${mk}`)) continue;
    const cKey = `${item.produtoId}|${item.unidadeVendaId}|${mk}`;
    fctsByKey.set(cKey, (fctsByKey.get(cKey) ?? 0) + (item.overrides[0]?.volumeFCTS ?? 0));
  }

  // Δ Ciclo Ant. (fallback ao vivo — espelha a lógica do snapshot.service):
  // dois ciclos aprovados mais recentes do ano, comparados APENAS nos meses que ambos
  // preveem (interseção das janelas) e dentro da janela exibida. O recorte por interseção
  // evita o artefato de janela deslocada (~ -1/N do horizonte) que aparecia mesmo sem revisão.
  const topTwoRuns = approvedRuns
    .filter(r => r.refMonth >= anoGte && r.refMonth < anoLt)
    .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())
    .slice(0, 2);

  const latestCycleFctsByUnit = new Map<string, number>();
  const prevCycleFctsByUnit   = new Map<string, number>();

  if (topTwoRuns.length === 2) {
    const runFctsByUnitMonth = async (runId: string) => {
      const items = await prisma.forecastItem.findMany({
        where:   { runId, gestorExcluido: false },
        include: { overrides: { take: 1, orderBy: { updatedAt: "desc" } } },
      });
      const m = new Map<string, number>();
      for (const it of items) {
        const key = `${it.unidadeVendaId}|${it.month.toISOString().substring(0, 7)}`;
        m.set(key, (m.get(key) ?? 0) + (it.overrides[0]?.volumeFCTS ?? 0));
      }
      return m;
    };

    const [latestRunMap, prevRunMap] = await Promise.all([
      runFctsByUnitMonth(topTwoRuns[0].id),
      runFctsByUnitMonth(topTwoRuns[1].id),
    ]);

    // Só meses na interseção dos dois ciclos E dentro de [startMonth, endMonth].
    for (const [key, latestFcts] of latestRunMap) {
      const prevFcts = prevRunMap.get(key);
      if (prevFcts === undefined) continue;
      const mk = key.substring(key.indexOf("|") + 1);
      if (mk < startMonth || mk > endMonth) continue;
      const unidade = key.substring(0, key.indexOf("|"));
      latestCycleFctsByUnit.set(unidade, (latestCycleFctsByUnit.get(unidade) ?? 0) + latestFcts);
      prevCycleFctsByUnit.set(unidade,   (prevCycleFctsByUnit.get(unidade)   ?? 0) + prevFcts);
    }
  }

  const vendasByKey = new Map<string, number>();
  for (const v of vendas) {
    const key = `${v.produtoId}|${v.unidadeVendaId}|${v.month.toISOString().substring(0, 7)}`;
    vendasByKey.set(key, (vendasByKey.get(key) ?? 0) + v.quantidade);
  }

  // Vendas por unidade×mês (independente de OrcamentoItems).
  // Mesma fonte (VendaMensal) mas agrupada sem depender do loop de orcItems —
  // garante que unidades sem ORC no ano (ex: adicionadas após o fechamento do ORC)
  // e meses cross-year sem ORC recebam os valores reais de VendaMensal.
  const vendasByUnitMonth = new Map<string, number>();
  for (const v of vendas) {
    const mk  = v.month.toISOString().substring(0, 7);
    const key = `${v.unidadeVendaId}|${mk}`;
    vendasByUnitMonth.set(key, (vendasByUnitMonth.get(key) ?? 0) + v.quantidade);
  }

  const subByUnitMonth = new Map<string, string>();
  for (const s of submissions) {
    const key = `${s.unidadeVendaId}|${s.refMonth.toISOString().substring(0, 7)}`;
    subByUnitMonth.set(key, s.status);
  }

  // 6. Gerar lista de meses da janela [startMonth, endMonth]
  const allMonthKeys: string[] = [];
  {
    const cur = new Date(`${startMonth}-01`);
    const end = new Date(`${endMonth}-01`);
    while (cur <= end) {
      allMonthKeys.push(cur.toISOString().substring(0, 7));
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  type MesData = { orc: number; fcts: number; vendas: number };
  type ProdData = { id: string; codigo: string; descricao: string; familia: string; orcAnual: number; fctsAnual: number; vendasAnual: number };
  type UnidadeAcc = {
    codigo: string; descricao: string; tipo: string;
    mesMap: Map<string, MesData>;
    produtosMap: Map<string, ProdData>;
    famMesMap: Map<string, Map<string, MesData>>;
  };

  const unidadesMap = new Map<string, UnidadeAcc>();
  // Set de chaves "produtoId|unidadeVendaId|YYYY-MM" já contabilizadas para FCTS/vendas
  // de produto e família. Evita multiplicar os valores para unidades EXPORT cujos
  // OrcamentoItems têm uma linha por país para o mesmo produto×mês.
  const seenFctsKeys = new Set<string>();

  for (const item of orcItems) {
    const uId = item.unidadeVendaId;
    if (!unidadesMap.has(uId)) {
      unidadesMap.set(uId, {
        codigo:      item.unidadeVenda.codigo,
        descricao:   item.unidadeVenda.descricao,
        tipo:        item.unidadeVenda.tipo,
        mesMap:      new Map(),
        produtosMap: new Map(),
        famMesMap:   new Map(),
      });
    }
    const u = unidadesMap.get(uId)!;
    const mk      = item.month.toISOString().substring(0, 7);
    const dataKey = `${item.produtoId}|${uId}|${mk}`;

    if (!u.mesMap.has(mk)) u.mesMap.set(mk, { orc: 0, fcts: 0, vendas: 0 });
    u.mesMap.get(mk)!.orc += item.volumeORC;

    // FCTS de unidade: uma vez por produto×unidade×mês, independente do número de
    // países com ORC (unidades EXPORT). seenFctsKeys actua em ambos os modos.
    const firstOccurrence = !seenFctsKeys.has(dataKey);
    if (firstOccurrence) {
      seenFctsKeys.add(dataKey);
      u.mesMap.get(mk)!.fcts += fctsByKey.get(dataKey) ?? 0;
    }

    // No modo lightweight omite o acúmulo pesado de produto e família
    if (!lightweight) {
      const familia = (item.produto.unidades.find(
        (pu) => pu.unidadeVendaId === uId
      )?.familia || 'Outros');
      if (!u.produtosMap.has(item.produtoId)) {
        u.produtosMap.set(item.produtoId, {
          id:          item.produtoId,
          codigo:      item.produto.codigo,
          descricao:   item.produto.descricao,
          familia,
          orcAnual:    0,
          fctsAnual:   0,
          vendasAnual: 0,
        });
      }
      const p = u.produtosMap.get(item.produtoId)!;
      p.orcAnual += item.volumeORC;

      // Produto/família: reutiliza o mesmo dedup já aplicado ao mesMap acima.
      if (firstOccurrence) {
        const fcts = fctsByKey.get(dataKey)   ?? 0;
        const vend = vendasByKey.get(dataKey) ?? 0;
        p.fctsAnual   += fcts;
        p.vendasAnual += vend;

        if (!u.famMesMap.has(familia)) u.famMesMap.set(familia, new Map());
        const famMes = u.famMesMap.get(familia)!;
        if (!famMes.has(mk)) famMes.set(mk, { orc: 0, fcts: 0, vendas: 0 });
        const fm = famMes.get(mk)!;
        fm.orc    += item.volumeORC;
        fm.fcts   += fcts;
        fm.vendas += vend;
      } else {
        // Países adicionais: só acumula ORC na família
        if (!u.famMesMap.has(familia)) u.famMesMap.set(familia, new Map());
        const famMes = u.famMesMap.get(familia)!;
        if (!famMes.has(mk)) famMes.set(mk, { orc: 0, fcts: 0, vendas: 0 });
        famMes.get(mk)!.orc += item.volumeORC;
      }
    }
  }

  // Produtos sem OrcamentoItem mas com FCTS — ex: produto novo lançado por estratégia
  // não contemplado no orçamento original. Devem aparecer no FCTS consolidado.
  const produtoMetaByFcKey = new Map<string, { codigo: string; descricao: string; familia: string; classe: string | null }>();
  for (const item of allForecastItems) {
    const mk = `${item.produtoId}|${item.unidadeVendaId}`;
    if (!produtoMetaByFcKey.has(mk)) {
      const familia = item.produto.unidades.find(u => u.unidadeVendaId === item.unidadeVendaId)?.familia ?? "Outros";
      produtoMetaByFcKey.set(mk, { codigo: item.produto.codigo, descricao: item.produto.descricao, familia, classe: item.produto.classe ?? null });
    }
  }

  for (const [key, fcts] of fctsByKey) {
    if (seenFctsKeys.has(key) || fcts === 0) continue;
    const [produtoId, unidadeVendaId, mk] = key.split("|");
    if (!unidadesMap.has(unidadeVendaId)) continue;
    const u = unidadesMap.get(unidadeVendaId)!;

    if (!u.mesMap.has(mk)) u.mesMap.set(mk, { orc: 0, fcts: 0, vendas: 0 });
    u.mesMap.get(mk)!.fcts += fcts;

    if (!lightweight) {
      const meta = produtoMetaByFcKey.get(`${produtoId}|${unidadeVendaId}`);
      if (meta) {
        const vend = vendasByKey.get(key) ?? 0;
        if (!u.produtosMap.has(produtoId)) {
          u.produtosMap.set(produtoId, { id: produtoId, codigo: meta.codigo, descricao: meta.descricao, familia: meta.familia, orcAnual: 0, fctsAnual: 0, vendasAnual: 0 });
        }
        u.produtosMap.get(produtoId)!.fctsAnual   += fcts;
        u.produtosMap.get(produtoId)!.vendasAnual += vend;

        if (!u.famMesMap.has(meta.familia)) u.famMesMap.set(meta.familia, new Map());
        const famMes = u.famMesMap.get(meta.familia)!;
        if (!famMes.has(mk)) famMes.set(mk, { orc: 0, fcts: 0, vendas: 0 });
        famMes.get(mk)!.fcts   += fcts;
        famMes.get(mk)!.vendas += vend;
      }
    }
  }

  // Produtos com vendas mas sem OrcamentoItem e sem ForecastItem — ex: produtos
  // vendidos mas não previstos nem orçados. Devem aparecer no breakdown de famílias
  // para que o total por mês não divirja do somatório das famílias.
  if (!lightweight) {
    const extraVendasByProdUnit = new Map<string, { uId: string; vendasByMes: Map<string, number> }>();
    for (const v of vendas) {
      const u = unidadesMap.get(v.unidadeVendaId);
      if (!u || u.produtosMap.has(v.produtoId)) continue;
      const puKey = `${v.produtoId}|${v.unidadeVendaId}`;
      if (!extraVendasByProdUnit.has(puKey))
        extraVendasByProdUnit.set(puKey, { uId: v.unidadeVendaId, vendasByMes: new Map() });
      const mk = v.month.toISOString().substring(0, 7);
      const slot = extraVendasByProdUnit.get(puKey)!;
      slot.vendasByMes.set(mk, (slot.vendasByMes.get(mk) ?? 0) + v.quantidade);
    }

    if (extraVendasByProdUnit.size > 0) {
      const extraProdIds = [...new Set([...extraVendasByProdUnit.keys()].map(k => k.split("|")[0]))];
      const extraProds = await prisma.produto.findMany({
        where:  { codigo: { in: extraProdIds } },
        select: {
          codigo:    true,
          descricao: true,
          unidades:  { select: { unidadeVendaId: true, familia: true } },
        },
      });
      const extraProdMeta = new Map(extraProds.map(p => [p.codigo, p]));

      for (const [puKey, slot] of extraVendasByProdUnit) {
        const [prodId] = puKey.split("|");
        const meta = extraProdMeta.get(prodId);
        if (!meta) continue;
        const u      = unidadesMap.get(slot.uId)!;
        const familia = meta.unidades.find(pu => pu.unidadeVendaId === slot.uId)?.familia || "Outros";
        let vendasAnual = 0;

        if (!u.famMesMap.has(familia)) u.famMesMap.set(familia, new Map());
        const famMes = u.famMesMap.get(familia)!;

        for (const [mk, qty] of slot.vendasByMes) {
          if (!famMes.has(mk)) famMes.set(mk, { orc: 0, fcts: 0, vendas: 0 });
          famMes.get(mk)!.vendas += qty;
          vendasAnual += qty;
        }

        u.produtosMap.set(prodId, {
          id:          prodId,
          codigo:      meta.codigo,
          descricao:   meta.descricao,
          familia,
          orcAnual:    0,
          fctsAnual:   0,
          vendasAnual,
        });
      }
    }
  }

  // ── Aplica vendas corretas; adiciona unidades/meses sem ORC ───────────────
  // FCTS já foi acumulado no loop acima (seenFctsKeys). Só precisamos substituir
  // as vendas — vendasByUnitMonth soma todas as VendaMensal da unidade×mês,
  // independentemente de existir OrcamentoItem (correto para unidades EXPORT).
  for (const [uId, u] of unidadesMap) {
    for (const mk of u.mesMap.keys()) {
      u.mesMap.get(mk)!.vendas = vendasByUnitMonth.get(`${uId}|${mk}`) ?? 0;
    }
    for (const [key, total] of vendasByUnitMonth) {
      const pipe = key.lastIndexOf('|');
      if (key.substring(0, pipe) !== uId) continue;
      const mk = key.substring(pipe + 1);
      if (u.mesMap.has(mk)) continue;
      u.mesMap.set(mk, { orc: 0, fcts: 0, vendas: total });
    }
  }

  // Passo 2: cria entradas para unidades que têm VendaMensal mas nenhum OrcamentoItem.
  // Requer buscar metadados (descricao, tipo) dessas unidades.
  const missingUnitIds = [...new Set(
    [...vendasByUnitMonth.keys()].map(k => k.substring(0, k.lastIndexOf('|')))
  )].filter(uid => !unidadesMap.has(uid));

  if (missingUnitIds.length > 0) {
    const unitMetas = await prisma.unidadeVenda.findMany({
      where:  { codigo: { in: missingUnitIds } },
      select: { codigo: true, descricao: true, tipo: true },
    });
    for (const meta of unitMetas) {
      const newAcc: UnidadeAcc = {
        codigo:     meta.codigo,
        descricao:  meta.descricao,
        tipo:       meta.tipo,
        mesMap:     new Map(),
        produtosMap: new Map(),
        famMesMap:  new Map(),
      };
      for (const [key, total] of vendasByUnitMonth) {
        const pipe = key.lastIndexOf('|');
        if (key.substring(0, pipe) !== meta.codigo) continue;
        newAcc.mesMap.set(key.substring(pipe + 1), { orc: 0, fcts: 0, vendas: total });
      }
      unidadesMap.set(meta.codigo, newAcc);
    }
  }

  // 7. Série mensal global (todas as unidades combinadas)
  const meses = allMonthKeys.map((mk) => {
    let orc = 0, fcts = 0, vendas = 0;
    for (const u of unidadesMap.values()) {
      const m = u.mesMap.get(mk);
      if (m) { orc += m.orc; fcts += m.fcts; vendas += m.vendas; }
    }
    return { month: `${mk}-01`, orc, fcts, vendas };
  });

  // 8. Construir array final de unidades
  // Desvio FCST × Vendas A.A. por unidade (filtro simétrico mensal)
  const priorGteC = new Date(`${startMonth}-01T00:00:00Z`); priorGteC.setUTCFullYear(priorGteC.getUTCFullYear() - 1);
  const priorLtC  = new Date(`${endMonth}-01T00:00:00Z`); priorLtC.setUTCMonth(priorLtC.getUTCMonth() + 1); priorLtC.setUTCFullYear(priorLtC.getUTCFullYear() - 1);
  const priorVendasC = await prisma.vendaMensal.findMany({
    where:  { month: { gte: priorGteC, lt: priorLtC } },
    select: { unidadeVendaId: true, produtoId: true, month: true, quantidade: true },
  });
  // Agrega a venda A.A. por (unidade, produto, mês-corrente) antes — evita somar o
  // FCST mais de uma vez quando há múltiplos países (EXPORT).
  const priorAggC = new Map<string, number>();
  for (const v of priorVendasC) {
    const cur = new Date(v.month); cur.setUTCFullYear(cur.getUTCFullYear() + 1);
    const k = `${v.unidadeVendaId}|${v.produtoId}|${cur.toISOString().substring(0, 7)}`;
    priorAggC.set(k, (priorAggC.get(k) ?? 0) + v.quantidade);
  }
  // Portfólio atual da unidade: pares (produto|unidade) com FCST ou ORC no período.
  // Restringe o vendaAA aos mesmos produtos exibidos (consistência colapsado×expandido).
  const portfolioPairsC = new Set<string>();
  for (const key of fctsByKey.keys()) { const [pr, un] = key.split("|"); portfolioPairsC.add(`${un}|${pr}`); }
  for (const it of orcItems)          { portfolioPairsC.add(`${it.unidadeVendaId}|${it.produtoId}`); }

  const desvioAAByUnitC = new Map<string, DesvioAA>();
  for (const [k, qty] of priorAggC) {
    if (qty <= 0) continue;
    const [uni, prod, curMk] = k.split("|");
    if (!portfolioPairsC.has(`${uni}|${prod}`)) continue;
    const acc = desvioAAByUnitC.get(uni) ?? { vendaAA: 0, fctsForDesvio: 0 };
    acc.vendaAA       += qty;
    acc.fctsForDesvio += fctsByKey.get(`${prod}|${uni}|${curMk}`) ?? 0;
    desvioAAByUnitC.set(uni, acc);
  }

  const unidades = Array.from(unidadesMap.entries()).map(([uCodigo, u]) => {
    const porMes = allMonthKeys.map((mk) => {
      const m      = u.mesMap.get(mk) ?? { orc: 0, fcts: 0, vendas: 0 };
      const subKey = `${uCodigo}|${mk}`;
      return {
        month:            `${mk}-01`,
        orc:              m.orc,
        fcts:             m.fcts,
        vendas:           m.vendas,
        submissionStatus: (subByUnitMonth.get(subKey) ?? null) as string | null,
      };
    });

    const orcAnual    = porMes.reduce((s, m) => s + m.orc,    0);
    const fctsAnual   = porMes.reduce((s, m) => s + m.fcts,   0);
    const vendasAnual = porMes.reduce((s, m) => s + m.vendas, 0);

    const latestStatus = [...porMes].reverse().find((m) => m.submissionStatus)?.submissionStatus ?? null;

    const base = {
      codigo:          uCodigo,
      descricao:       u.descricao,
      tipo:            u.tipo,
      orcAnual,
      fctsAnual,
      vendasAnual,
      submissaoStatus: latestStatus,
      latestCycleFcts: latestCycleFctsByUnit.get(uCodigo) ?? 0,
      prevCycleFcts:   prevCycleFctsByUnit.get(uCodigo)   ?? 0,
      vendaAA:       desvioAAByUnitC.get(uCodigo)?.vendaAA       ?? null,
      fctsForDesvio: desvioAAByUnitC.get(uCodigo)?.fctsForDesvio ?? null,
      porMes,
      // Campos pesados: retornados como arrays vazios no modo lightweight
      produtos:     [] as object[],
      familiaMeses: [] as object[],
    };

    if (lightweight) return base;

    return {
      ...base,
      produtos: Array.from(u.produtosMap.values()).sort((a, b) =>
        a.familia.localeCompare(b.familia) || a.codigo.localeCompare(b.codigo)
      ),
      familiaMeses: Array.from(u.famMesMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([familia, mesMap]) => ({
          familia,
          porMes: allMonthKeys.map((mk) => ({
            month:  `${mk}-01`,
            ...(mesMap.get(mk) ?? { orc: 0, fcts: 0, vendas: 0 }),
          })),
        })),
    };
  });

  const result = { run, meses, unidades, crossYear };
  appCache.set(cacheKey, result, 5 * 60 * 1000);
  return result;
};

// ── Detalhe de uma única unidade (Fase 3 — lazy load ao expandir) ──────────

/**
 * Retorna os arrays pesados (porMes, produtos, familiaMeses) para UMA unidade.
 * Chamado pelo frontend ao expandir uma linha na tabela, evitando carregar
 * esses dados para todas as unidades na carga inicial (lightweight mode).
 */
export const getConsolidadoUnidade = async (
  unidadeVendaId: string,
  startMonth: string,
  endMonth: string,
) => {
  const cacheKey = `consolidado-unidade|${unidadeVendaId}|${startMonth}|${endMonth}`;
  const cached = appCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  // ── Tenta servir do snapshot pré-computado ─────────────────────────────────
  {
    const anoGteSnap = new Date(`${startMonth}-01T00:00:00Z`);
    const anoLtSnap  = new Date(`${endMonth}-01T00:00:00Z`);
    anoLtSnap.setUTCMonth(anoLtSnap.getUTCMonth() + 1);
    const whereSnap = { unidadeVendaId, refMonth: { gte: anoGteSnap, lt: anoLtSnap } } as const;

    // Três groupBy paralelos + stale check + submission status —
    // o DB agrega os milhares de linhas de produto; o Node.js recebe apenas
    // ~12 (porMes) + ~350 (produtos) + ~350 (familia×mês) linhas.
    const [porMesAgg, produtosAgg, familiaMesesAgg, staleCheck, submissions, fctsProdMesAgg, vendaAAMap] = await Promise.all([
      prisma.consolidadoProdutoMesSnapshot.groupBy({
        by:    ['refMonth'],
        where: whereSnap,
        _sum:  { orc: true, fcts: true, vendas: true },
      }),
      prisma.consolidadoProdutoMesSnapshot.groupBy({
        by:    ['produtoId', 'produtoCodigo', 'produtoDescricao', 'familia'],
        where: whereSnap,
        _sum:  { orc: true, fcts: true, vendas: true },
      }),
      prisma.consolidadoProdutoMesSnapshot.groupBy({
        by:    ['familia', 'refMonth'],
        where: whereSnap,
        _sum:  { orc: true, fcts: true, vendas: true },
      }),
      prisma.consolidadoProdutoMesSnapshot.findFirst({
        where:   whereSnap,
        orderBy: { computedAt: 'asc' },
        select:  { computedAt: true },
      }),
      prisma.divisionSubmission.findMany({
        where:  { unidadeVendaId, refMonth: { gte: anoGteSnap, lt: anoLtSnap } },
        select: { refMonth: true, status: true },
      }),
      // FCTS por (produto, mês) — base do filtro simétrico do desvio A.A.
      prisma.consolidadoProdutoMesSnapshot.groupBy({
        by:    ['produtoId', 'refMonth'],
        where: whereSnap,
        _sum:  { fcts: true },
      }),
      // Venda do ano anterior por (produto, mês-corrente)
      fetchVendaAAByProdMonth(unidadeVendaId, startMonth, endMonth),
    ]);

    if (porMesAgg.length > 0) {
      // Stale-while-revalidate: serve mesmo se stale, dispara refresh em background
      // apenas para o ano corrente — anos históricos são imutáveis após fechamento.
      const isFresh = staleCheck ? staleCheck.computedAt.getTime() > Date.now() - SNAPSHOT_STALE_MS : false;
      if (!isFresh) {
        const endYearSnap = parseInt(endMonth.substring(0, 4), 10);
        const currentYear = new Date().getUTCFullYear();
        if (endYearSnap >= currentYear) {
          void SnapshotService.refreshConsolidadoSnapshot(endYearSnap, { affectedUnits: [unidadeVendaId] })
            .catch(err => console.error('[snapshot] bg-refresh (getConsolidadoUnidade) failed:', err));
        }
      }

      const subByMonth = new Map(
        submissions.map(s => [s.refMonth.toISOString().substring(0, 7), s.status])
      );

      const allMonthKeysSnap: string[] = [];
      const cur = new Date(`${startMonth}-01`);
      const end = new Date(`${endMonth}-01`);
      while (cur <= end) {
        allMonthKeysSnap.push(cur.toISOString().substring(0, 7));
        cur.setMonth(cur.getMonth() + 1);
      }

      // porMes — já agregado pelo DB, apenas formata e zero-fill meses sem dados
      const porMesMap = new Map(
        porMesAgg.map(r => [r.refMonth.toISOString().substring(0, 7), r._sum])
      );
      const porMes = allMonthKeysSnap.map(mk => ({
        month:            `${mk}-01`,
        orc:              porMesMap.get(mk)?.orc    ?? 0,
        fcts:             porMesMap.get(mk)?.fcts   ?? 0,
        vendas:           porMesMap.get(mk)?.vendas ?? 0,
        submissionStatus: (subByMonth.get(mk) ?? null) as string | null,
      }));

      // Desvio FCST × Vendas A.A. por produto (filtro simétrico mensal)
      const fctsByProdMonth = new Map<string, Map<string, number>>();
      for (const r of fctsProdMesAgg) {
        const mk = r.refMonth.toISOString().substring(0, 7);
        if (!fctsByProdMonth.has(r.produtoId)) fctsByProdMonth.set(r.produtoId, new Map());
        fctsByProdMonth.get(r.produtoId)!.set(mk, r._sum.fcts ?? 0);
      }
      const desvioAAMap = computeDesvioAAPorProduto(fctsByProdMonth, vendaAAMap);

      // produtos — um objeto por produto, já com totais agregados pelo DB
      const produtos = produtosAgg
        .map(r => ({
          id:          r.produtoId,
          codigo:      r.produtoCodigo,
          descricao:   r.produtoDescricao,
          familia:     r.familia ?? "Outros",
          orcAnual:    r._sum.orc    ?? 0,
          fctsAnual:   r._sum.fcts   ?? 0,
          vendasAnual: r._sum.vendas ?? 0,
          vendaAA:       desvioAAMap.get(r.produtoId)?.vendaAA       ?? null,
          fctsForDesvio: desvioAAMap.get(r.produtoId)?.fctsForDesvio ?? null,
        }))
        .sort((a, b) => a.familia.localeCompare(b.familia) || a.codigo.localeCompare(b.codigo));

      // familiaMeses — agrupa as ~350 linhas familia×mês retornadas pelo DB
      const famMesMap = new Map<string, Map<string, { orc: number; fcts: number; vendas: number }>>();
      for (const r of familiaMesesAgg) {
        const familia = r.familia ?? "Outros";
        const mk      = r.refMonth.toISOString().substring(0, 7);
        if (!famMesMap.has(familia)) famMesMap.set(familia, new Map());
        famMesMap.get(familia)!.set(mk, {
          orc:    r._sum.orc    ?? 0,
          fcts:   r._sum.fcts   ?? 0,
          vendas: r._sum.vendas ?? 0,
        });
      }
      const familiaMeses = Array.from(famMesMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([familia, mMap]) => ({
          familia,
          porMes: allMonthKeysSnap.map(mk => ({
            month: `${mk}-01`,
            ...(mMap.get(mk) ?? { orc: 0, fcts: 0, vendas: 0 }),
          })),
        }));

      const result = { porMes, produtos, familiaMeses };
      appCache.set(cacheKey, result, 5 * 60 * 1000);
      return result;
    }
  }
  // ── Fim do bloco de snapshot — porMesAgg vazio, executa query ao vivo ───────

  const anoGte = new Date(`${startMonth}-01`);
  const endDate = new Date(`${endMonth}-01`);
  endDate.setMonth(endDate.getMonth() + 1);
  const anoLt = endDate;

  const endYear   = parseInt(endMonth.substring(0, 4), 10);
  const startYear = parseInt(startMonth.substring(0, 4), 10);
  const crossYear = startYear !== endYear;
  const orcAnosNeeded = crossYear ? [startYear, endYear] : [endYear];

  const allMonthKeys: string[] = [];
  {
    const cur = new Date(`${startMonth}-01`);
    const end = new Date(`${endMonth}-01`);
    while (cur <= end) {
      allMonthKeys.push(cur.toISOString().substring(0, 7));
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  const [orcItems, approvedSubsAll, vendas, submissions] = await Promise.all([
    prisma.orcamentoItem.findMany({
      where: {
        unidadeVendaId,
        month:        { gte: anoGte, lt: anoLt },
        orcamentoAno: { in: orcAnosNeeded },
      },
      include: {
        produto: {
          select: {
            codigo:   true,
            descricao: true,
            unidades: { select: { unidadeVendaId: true, familia: true } },
          },
        },
      },
    }),
    prisma.divisionSubmission.findMany({
      where:  { status: "APPROVED" },
      select: { unidadeVendaId: true, refMonth: true },
    }),
    prisma.vendaMensal.findMany({
      where:  { unidadeVendaId, month: { gte: anoGte, lt: anoLt } },
      select: { produtoId: true, month: true, quantidade: true },
    }),
    prisma.divisionSubmission.findMany({
      where:  { unidadeVendaId, refMonth: { gte: anoGte, lt: anoLt } },
      select: { refMonth: true, status: true },
    }),
  ]);

  // Filtrar submissions aprovados para esta unidade e obter runs aprovados
  const unitApprovedSubs = approvedSubsAll.filter(s => s.unidadeVendaId === unidadeVendaId);
  const approvedRefMonths = [...new Set(unitApprovedSubs.map(s => s.refMonth.toISOString()))];

  const approvedRuns = approvedRefMonths.length > 0
    ? await prisma.forecastRun.findMany({
        where:  { refMonth: { in: approvedRefMonths.map(m => new Date(m)) }, status: "SUCCESS" },
        select: { id: true, refMonth: true, executedAt: true, windowStart: true, windowEnd: true },
      })
    : [];

  const runByRefMonth   = new Map<string, string>(approvedRuns.map(r => [r.refMonth.toISOString(), r.id]));
  const approvedRunIds  = approvedRuns.map(r => r.id);

  const approvedRunIdsForUnit = new Set(
    unitApprovedSubs
      .map(s => runByRefMonth.get(s.refMonth.toISOString()))
      .filter((id): id is string => !!id)
  );

  // Ciclo vencedor por (unidade, mês) — ver utils/forecast-cycle.ts
  const runMetaById = new Map<string, ForecastRunMeta>(approvedRuns.map(r => [r.id, r]));
  const winningRun  = winningRunByUnitMonth(new Map([[unidadeVendaId, approvedRunIdsForUnit]]), runMetaById);

  const allForecastItems = approvedRunIds.length > 0
    ? await prisma.forecastItem.findMany({
        where: {
          unidadeVendaId,
          month:          { gte: anoGte, lt: anoLt },
          runId:          { in: approvedRunIds },
          gestorExcluido: false,
        },
        include: {
          overrides: { take: 1, orderBy: { updatedAt: "desc" } },
          produto:   { select: { codigo: true, descricao: true, classe: true,
                                 unidades: { select: { unidadeVendaId: true, familia: true } } } },
        },
      })
    : [];

  // FCTS por produto×mês vindo APENAS do ciclo vencedor de cada mês (sem catraca).
  const fctsByKey = new Map<string, number>();
  for (const item of allForecastItems) {
    const mk = item.month.toISOString().substring(0, 7);
    if (item.runId !== winningRun.get(`${unidadeVendaId}|${mk}`)) continue;
    const cKey = `${item.produtoId}|${mk}`;
    fctsByKey.set(cKey, (fctsByKey.get(cKey) ?? 0) + (item.overrides[0]?.volumeFCTS ?? 0));
  }

  const vendasByKey = new Map<string, number>();
  for (const v of vendas) {
    const key = `${v.produtoId}|${v.month.toISOString().substring(0, 7)}`;
    vendasByKey.set(key, (vendasByKey.get(key) ?? 0) + v.quantidade);
  }

  // Vendas totais por mês (soma de todos os produtos, independente de OrcamentoItems).
  // Garante que meses sem ORC — ex: meses do ano anterior em janelas cross-year —
  // apresentem as vendas reais registradas em VendaMensal.
  const vendasByMonth = new Map<string, number>();
  for (const v of vendas) {
    const mk = v.month.toISOString().substring(0, 7);
    vendasByMonth.set(mk, (vendasByMonth.get(mk) ?? 0) + v.quantidade);
  }

  const subByMonth = new Map<string, string>();
  for (const s of submissions) {
    subByMonth.set(s.refMonth.toISOString().substring(0, 7), s.status);
  }

  type MesData  = { orc: number; fcts: number; vendas: number };
  type ProdData = { id: string; codigo: string; descricao: string; familia: string; orcAnual: number; fctsAnual: number; vendasAnual: number };

  const mesMap      = new Map<string, MesData>();
  const produtosMap = new Map<string, ProdData>();
  const famMesMap   = new Map<string, Map<string, MesData>>();
  // Dedup: "produtoId|YYYY-MM" já contabilizado para FCTS/vendas de produto/família.
  const seenFctsKeys = new Set<string>();

  for (const item of orcItems) {
    const mk      = item.month.toISOString().substring(0, 7);
    const dataKey = `${item.produtoId}|${mk}`;

    if (!mesMap.has(mk)) mesMap.set(mk, { orc: 0, fcts: 0, vendas: 0 });
    mesMap.get(mk)!.orc += item.volumeORC;

    const familia = item.produto.unidades.find(pu => pu.unidadeVendaId === unidadeVendaId)?.familia || 'Outros';

    if (!produtosMap.has(item.produtoId)) {
      produtosMap.set(item.produtoId, {
        id:          item.produtoId,
        codigo:      item.produto.codigo,
        descricao:   item.produto.descricao,
        familia,
        orcAnual:    0,
        fctsAnual:   0,
        vendasAnual: 0,
      });
    }
    const p = produtosMap.get(item.produtoId)!;
    p.orcAnual += item.volumeORC;

    // FCTS: uma vez por produto×mês, independente do número de países com ORC.
    // Aplica também ao mesMap (unidade-mês) pelo mesmo dedup.
    if (!seenFctsKeys.has(dataKey)) {
      seenFctsKeys.add(dataKey);
      const fcts = fctsByKey.get(dataKey)   ?? 0;
      const vend = vendasByKey.get(dataKey) ?? 0;
      mesMap.get(mk)!.fcts += fcts;
      p.fctsAnual   += fcts;
      p.vendasAnual += vend;

      if (!famMesMap.has(familia)) famMesMap.set(familia, new Map());
      const famMes = famMesMap.get(familia)!;
      if (!famMes.has(mk)) famMes.set(mk, { orc: 0, fcts: 0, vendas: 0 });
      const fm = famMes.get(mk)!;
      fm.orc    += item.volumeORC;
      fm.fcts   += fcts;
      fm.vendas += vend;
    } else {
      // País adicional: apenas ORC da família
      if (!famMesMap.has(familia)) famMesMap.set(familia, new Map());
      const famMes = famMesMap.get(familia)!;
      if (!famMes.has(mk)) famMes.set(mk, { orc: 0, fcts: 0, vendas: 0 });
      famMes.get(mk)!.orc += item.volumeORC;
    }
  }

  // Produtos sem OrcamentoItem mas com FCTS — ex: produto novo não contemplado no orçamento.
  const produtoMetaByIdUnit = new Map<string, { codigo: string; descricao: string; familia: string }>();
  for (const item of allForecastItems) {
    if (!produtoMetaByIdUnit.has(item.produtoId)) {
      const familia = item.produto.unidades.find(u => u.unidadeVendaId === unidadeVendaId)?.familia ?? "Outros";
      produtoMetaByIdUnit.set(item.produtoId, { codigo: item.produto.codigo, descricao: item.produto.descricao, familia });
    }
  }

  for (const [key, fcts] of fctsByKey) {
    if (seenFctsKeys.has(key) || fcts === 0) continue;
    const [produtoId, mk] = key.split("|");
    const meta = produtoMetaByIdUnit.get(produtoId);
    if (!meta) continue;

    const vend = vendasByKey.get(key) ?? 0;
    if (!mesMap.has(mk)) mesMap.set(mk, { orc: 0, fcts: 0, vendas: 0 });
    mesMap.get(mk)!.fcts += fcts;

    if (!produtosMap.has(produtoId)) {
      produtosMap.set(produtoId, { id: produtoId, codigo: meta.codigo, descricao: meta.descricao, familia: meta.familia, orcAnual: 0, fctsAnual: 0, vendasAnual: 0 });
    }
    produtosMap.get(produtoId)!.fctsAnual   += fcts;
    produtosMap.get(produtoId)!.vendasAnual += vend;

    if (!famMesMap.has(meta.familia)) famMesMap.set(meta.familia, new Map());
    const famMes = famMesMap.get(meta.familia)!;
    if (!famMes.has(mk)) famMes.set(mk, { orc: 0, fcts: 0, vendas: 0 });
    famMes.get(mk)!.fcts   += fcts;
    famMes.get(mk)!.vendas += vend;
  }

  // Produtos com vendas mas sem OrcamentoItem e sem ForecastItem — ex: produtos
  // vendidos mas não previstos nem orçados. Devem aparecer no breakdown de famílias
  // para que o total por mês não divirja do somatório das famílias.
  {
    const extraVendasByProdMes = new Map<string, number>();
    const extraProdIds = new Set<string>();
    for (const v of vendas) {
      if (produtosMap.has(v.produtoId)) continue;
      const mk  = v.month.toISOString().substring(0, 7);
      const key = `${v.produtoId}|${mk}`;
      extraVendasByProdMes.set(key, (extraVendasByProdMes.get(key) ?? 0) + v.quantidade);
      extraProdIds.add(v.produtoId);
    }

    if (extraProdIds.size > 0) {
      const extraProds = await prisma.produto.findMany({
        where:  { codigo: { in: [...extraProdIds] } },
        select: {
          codigo:    true,
          descricao: true,
          unidades:  { where: { unidadeVendaId }, select: { familia: true }, take: 1 },
        },
      });

      for (const p of extraProds) {
        const familia   = p.unidades[0]?.familia || "Outros";
        let vendasAnual = 0;

        if (!famMesMap.has(familia)) famMesMap.set(familia, new Map());
        const famMes = famMesMap.get(familia)!;

        for (const [key, qty] of extraVendasByProdMes) {
          if (!key.startsWith(`${p.codigo}|`)) continue;
          const mk = key.substring(p.codigo.length + 1);
          if (!famMes.has(mk)) famMes.set(mk, { orc: 0, fcts: 0, vendas: 0 });
          famMes.get(mk)!.vendas += qty;
          vendasAnual += qty;
        }

        if (vendasAnual === 0) continue;

        produtosMap.set(p.codigo, {
          id:          p.codigo,
          codigo:      p.codigo,
          descricao:   p.descricao,
          familia,
          orcAnual:    0,
          fctsAnual:   0,
          vendasAnual,
        });
      }
    }
  }

  // ── Aplica vendas corretas; cria entradas para meses sem OrcamentoItem ───────
  // FCTS já foi acumulado no loop acima (seenFctsKeys). vendasByMonth soma todas
  // as VendaMensal da unidade×mês, independente de existir OrcamentoItem.
  for (const [mk, total] of vendasByMonth) {
    if (!mesMap.has(mk)) mesMap.set(mk, { orc: 0, fcts: 0, vendas: 0 });
    mesMap.get(mk)!.vendas = total;
  }

  const porMes = allMonthKeys.map(mk => ({
    month:            `${mk}-01`,
    orc:              mesMap.get(mk)?.orc    ?? 0,
    fcts:             mesMap.get(mk)?.fcts   ?? 0,
    vendas:           mesMap.get(mk)?.vendas ?? 0,
    submissionStatus: (subByMonth.get(mk) ?? null) as string | null,
  }));

  // Desvio FCST × Vendas A.A. por produto (filtro simétrico mensal)
  const vendaAAMapUnit = await fetchVendaAAByProdMonth(unidadeVendaId, startMonth, endMonth);
  const fctsByProdMonthUnit = new Map<string, Map<string, number>>();
  for (const [k, fctsVal] of fctsByKey) {
    const sep = k.indexOf("|");
    const prod = k.slice(0, sep), mkF = k.slice(sep + 1);
    if (!fctsByProdMonthUnit.has(prod)) fctsByProdMonthUnit.set(prod, new Map());
    const mm = fctsByProdMonthUnit.get(prod)!;
    mm.set(mkF, (mm.get(mkF) ?? 0) + fctsVal);
  }
  const desvioAAMapUnit = computeDesvioAAPorProduto(fctsByProdMonthUnit, vendaAAMapUnit);

  const produtos = Array.from(produtosMap.values())
    .map(p => ({
      ...p,
      vendaAA:       desvioAAMapUnit.get(p.id)?.vendaAA       ?? null,
      fctsForDesvio: desvioAAMapUnit.get(p.id)?.fctsForDesvio ?? null,
    }))
    .sort((a, b) => a.familia.localeCompare(b.familia) || a.codigo.localeCompare(b.codigo));

  const familiaMeses = Array.from(famMesMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([familia, mMap]) => ({
      familia,
      porMes: allMonthKeys.map(mk => ({
        month:  `${mk}-01`,
        ...(mMap.get(mk) ?? { orc: 0, fcts: 0, vendas: 0 }),
      })),
    }));

  const result = { porMes, produtos, familiaMeses };
  appCache.set(cacheKey, result, 5 * 60 * 1000);
  return result;
};

// ── Breakdown por país de uma unidade EXPORT (lazy load ao expandir) ────────

interface PaisConsolidado {
  iso3:        string;
  nome:        string;
  orcAnual:    number;
  fctsAnual:   number;
  vendasAnual: number;
  porMes:      { month: string; orc: number; fcts: number; vendas: number }[];
}

export const getConsolidadoUnidadePaises = async (
  unidadeVendaId: string,
  startMonth: string,
  endMonth: string,
): Promise<PaisConsolidado[]> => {
  const anoGte  = new Date(`${startMonth}-01T00:00:00Z`);
  const endDate = new Date(`${endMonth}-01T00:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const anoLt = endDate;

  const allMonthKeys: string[] = [];
  {
    const cur = new Date(`${startMonth}-01T00:00:00Z`);
    const end = new Date(`${endMonth}-01T00:00:00Z`);
    while (cur <= end) {
      allMonthKeys.push(cur.toISOString().substring(0, 7));
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }

  const endYear   = parseInt(endMonth.substring(0, 4), 10);
  const startYear = parseInt(startMonth.substring(0, 4), 10);
  const crossYear = startYear !== endYear;
  const orcAnosNeeded = crossYear ? [startYear, endYear] : [endYear];

  const [paises, orcItems, approvedSubsAll, vendas] = await Promise.all([
    prisma.pais.findMany({
      where:  { unidadeVendaId, ativo: true },
      select: { iso3: true, nome: true },
      orderBy: { iso3: "asc" },
    }),
    prisma.orcamentoItem.findMany({
      where: {
        unidadeVendaId,
        month:        { gte: anoGte, lt: anoLt },
        orcamentoAno: { in: orcAnosNeeded },
        paisIso3:     { not: null },
      },
      select: { produtoId: true, month: true, paisIso3: true, volumeORC: true },
    }),
    prisma.divisionSubmission.findMany({
      where:  { unidadeVendaId, status: "APPROVED" },
      select: { refMonth: true },
    }),
    prisma.vendaMensal.findMany({
      where: {
        unidadeVendaId,
        month:    { gte: anoGte, lt: anoLt },
        paisIso3: { not: null },
      },
      select: { produtoId: true, month: true, paisIso3: true, quantidade: true },
    }),
  ]);

  const approvedRefMonths = [...new Set(approvedSubsAll.map(s => s.refMonth.toISOString()))];
  const approvedRuns = approvedRefMonths.length > 0
    ? await prisma.forecastRun.findMany({
        where:  { refMonth: { in: approvedRefMonths.map(m => new Date(m)) }, status: "SUCCESS" },
        select: { id: true, refMonth: true, executedAt: true, windowStart: true, windowEnd: true },
      })
    : [];

  const approvedRunIds = approvedRuns.map(r => r.id);

  // Ciclo vencedor por (unidade, mês) — ver utils/forecast-cycle.ts
  const runMetaById = new Map<string, ForecastRunMeta>(approvedRuns.map(r => [r.id, r]));
  const winningRun  = winningRunByUnitMonth(new Map([[unidadeVendaId, new Set(approvedRunIds)]]), runMetaById);

  const allForecastItems = approvedRunIds.length > 0
    ? await prisma.forecastItem.findMany({
        where: {
          unidadeVendaId,
          month:          { gte: anoGte, lt: anoLt },
          runId:          { in: approvedRunIds },
          gestorExcluido: false,
          paisIso3:       { not: null },
        },
        include: { overrides: { take: 1, orderBy: { updatedAt: "desc" } } },
      })
    : [];

  // FCTS por país+mês (somado por produto) — apenas do ciclo vencedor de cada mês
  const fctsByPaisMes = new Map<string, number>(); // `${paisIso3}|${mk}` → total
  for (const item of allForecastItems) {
    const mk = item.month.toISOString().substring(0, 7);
    if (item.runId !== winningRun.get(`${unidadeVendaId}|${mk}`)) continue;
    const gKey = `${item.paisIso3}|${mk}`;
    fctsByPaisMes.set(gKey, (fctsByPaisMes.get(gKey) ?? 0) + (item.overrides[0]?.volumeFCTS ?? 0));
  }

  // ORC por país+mês
  const orcByPaisMes = new Map<string, number>();
  for (const item of orcItems) {
    const mk  = item.month.toISOString().substring(0, 7);
    const key = `${item.paisIso3}|${mk}`;
    orcByPaisMes.set(key, (orcByPaisMes.get(key) ?? 0) + item.volumeORC);
  }

  // Vendas por país+mês
  const vendasByPaisMes = new Map<string, number>();
  for (const v of vendas) {
    const mk  = v.month.toISOString().substring(0, 7);
    const key = `${v.paisIso3}|${mk}`;
    vendasByPaisMes.set(key, (vendasByPaisMes.get(key) ?? 0) + v.quantidade);
  }

  // Monta resultado por país
  return paises.map(pais => {
    const porMes = allMonthKeys.map(mk => ({
      month:  `${mk}-01`,
      orc:    orcByPaisMes.get(`${pais.iso3}|${mk}`)   ?? 0,
      fcts:   fctsByPaisMes.get(`${pais.iso3}|${mk}`)  ?? 0,
      vendas: vendasByPaisMes.get(`${pais.iso3}|${mk}`) ?? 0,
    }));
    return {
      iso3:        pais.iso3,
      nome:        pais.nome,
      orcAnual:    porMes.reduce((s, m) => s + m.orc,    0),
      fctsAnual:   porMes.reduce((s, m) => s + m.fcts,   0),
      vendasAnual: porMes.reduce((s, m) => s + m.vendas, 0),
      porMes,
    };
  }).sort((a, b) => b.vendasAnual - a.vendasAnual || b.orcAnual - a.orcAnual);
};

// ── Detalhe produto×família×mês para um país específico de unidade EXPORT ───

/**
 * Retorna os dados detalhados (porMes, produtos, familiaMeses) para UMA unidade + UM país.
 * Mesmo shape que getConsolidadoUnidade, mas filtrado por paisIso3.
 * Permite reutilizar o FamiliaBreakdownSection sem modificação.
 */
export const getConsolidadoUnidadePaisDetail = async (
  unidadeVendaId: string,
  paisIso3: string,
  startMonth: string,
  endMonth: string,
) => {
  const anoGte  = new Date(`${startMonth}-01T00:00:00Z`);
  const endDate = new Date(`${endMonth}-01T00:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const anoLt = endDate;

  const endYear   = parseInt(endMonth.substring(0, 4), 10);
  const startYear = parseInt(startMonth.substring(0, 4), 10);
  const crossYear = startYear !== endYear;
  const orcAnosNeeded = crossYear ? [startYear, endYear] : [endYear];

  const allMonthKeys: string[] = [];
  {
    const cur = new Date(`${startMonth}-01T00:00:00Z`);
    const end = new Date(`${endMonth}-01T00:00:00Z`);
    while (cur <= end) {
      allMonthKeys.push(cur.toISOString().substring(0, 7));
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }

  const [orcItems, approvedSubsAll, vendas, submissions] = await Promise.all([
    prisma.orcamentoItem.findMany({
      where: {
        unidadeVendaId,
        paisIso3,
        month:        { gte: anoGte, lt: anoLt },
        orcamentoAno: { in: orcAnosNeeded },
      },
      include: {
        produto: {
          select: {
            codigo:   true,
            descricao: true,
            unidades: { select: { unidadeVendaId: true, familia: true } },
          },
        },
      },
    }),
    prisma.divisionSubmission.findMany({
      where:  { unidadeVendaId, status: "APPROVED" },
      select: { refMonth: true },
    }),
    prisma.vendaMensal.findMany({
      where:  { unidadeVendaId, paisIso3, month: { gte: anoGte, lt: anoLt } },
      select: { produtoId: true, month: true, quantidade: true },
    }),
    prisma.divisionSubmission.findMany({
      where:  { unidadeVendaId, refMonth: { gte: anoGte, lt: anoLt } },
      select: { refMonth: true, status: true },
    }),
  ]);

  const approvedRefMonths = [...new Set(approvedSubsAll.map(s => s.refMonth.toISOString()))];
  const approvedRuns = approvedRefMonths.length > 0
    ? await prisma.forecastRun.findMany({
        where:  { refMonth: { in: approvedRefMonths.map(m => new Date(m)) }, status: "SUCCESS" },
        select: { id: true, refMonth: true, executedAt: true, windowStart: true, windowEnd: true },
      })
    : [];

  const approvedRunIds   = approvedRuns.map(r => r.id);

  // Ciclo vencedor por (unidade, mês) — ver utils/forecast-cycle.ts
  const runMetaById = new Map<string, ForecastRunMeta>(approvedRuns.map(r => [r.id, r]));
  const winningRun  = winningRunByUnitMonth(new Map([[unidadeVendaId, new Set(approvedRunIds)]]), runMetaById);

  const allForecastItems = approvedRunIds.length > 0
    ? await prisma.forecastItem.findMany({
        where: {
          unidadeVendaId,
          paisIso3,
          month:          { gte: anoGte, lt: anoLt },
          runId:          { in: approvedRunIds },
          gestorExcluido: false,
        },
        include: { overrides: { take: 1, orderBy: { updatedAt: "desc" } } },
      })
    : [];

  // FCTS por produto×mês (país fixo) vindo APENAS do ciclo vencedor de cada mês.
  const fctsByKey = new Map<string, number>();
  for (const item of allForecastItems) {
    const mk  = item.month.toISOString().substring(0, 7);
    if (item.runId !== winningRun.get(`${unidadeVendaId}|${mk}`)) continue;
    const key = `${item.produtoId}|${mk}`;
    fctsByKey.set(key, (fctsByKey.get(key) ?? 0) + (item.overrides[0]?.volumeFCTS ?? 0));
  }

  const vendasByKey = new Map<string, number>();
  for (const v of vendas) {
    const key = `${v.produtoId}|${v.month.toISOString().substring(0, 7)}`;
    vendasByKey.set(key, (vendasByKey.get(key) ?? 0) + v.quantidade);
  }

  // Vendas totais por mês (filtradas por país, soma de todos os produtos, independente de OrcamentoItems).
  // Garante que meses sem ORC — ex: meses do ano anterior em janelas cross-year —
  // apresentem as vendas reais registradas em VendaMensal.
  const vendasByMonth = new Map<string, number>();
  for (const v of vendas) {
    const mk = v.month.toISOString().substring(0, 7);
    vendasByMonth.set(mk, (vendasByMonth.get(mk) ?? 0) + v.quantidade);
  }

  const subByMonth = new Map<string, string>();
  for (const s of submissions) {
    subByMonth.set(s.refMonth.toISOString().substring(0, 7), s.status);
  }

  type MesData  = { orc: number; fcts: number; vendas: number };
  type ProdData = { id: string; codigo: string; descricao: string; familia: string; orcAnual: number; fctsAnual: number; vendasAnual: number };

  const mesMap     = new Map<string, MesData>();
  const produtosMap = new Map<string, ProdData>();
  const famMesMap   = new Map<string, Map<string, MesData>>();

  for (const item of orcItems) {
    const mk      = item.month.toISOString().substring(0, 7);
    const dataKey = `${item.produtoId}|${mk}`;
    const fcts    = fctsByKey.get(dataKey) ?? 0;
    const vend    = vendasByKey.get(dataKey) ?? 0;

    if (!mesMap.has(mk)) mesMap.set(mk, { orc: 0, fcts: 0, vendas: 0 });
    const m = mesMap.get(mk)!;
    m.orc    += item.volumeORC;
    m.fcts   += fcts;
    m.vendas += vend;

    const familia = item.produto.unidades.find(pu => pu.unidadeVendaId === unidadeVendaId)?.familia || 'Outros';

    if (!produtosMap.has(item.produtoId)) {
      produtosMap.set(item.produtoId, {
        id:          item.produtoId,
        codigo:      item.produto.codigo,
        descricao:   item.produto.descricao,
        familia,
        orcAnual:    0,
        fctsAnual:   0,
        vendasAnual: 0,
      });
    }
    const p = produtosMap.get(item.produtoId)!;
    p.orcAnual    += item.volumeORC;
    p.fctsAnual   += fcts;
    p.vendasAnual += vend;

    if (!famMesMap.has(familia)) famMesMap.set(familia, new Map());
    const famMes = famMesMap.get(familia)!;
    if (!famMes.has(mk)) famMes.set(mk, { orc: 0, fcts: 0, vendas: 0 });
    const fm = famMes.get(mk)!;
    fm.orc    += item.volumeORC;
    fm.fcts   += fcts;
    fm.vendas += vend;
  }

  // ── Produtos com vendas ou FCTS mas sem OrcamentoItem para este país ────────
  // Ex: produtos comercializados na Turquia sem entrada no ORC de exportação.
  // Sem este bloco, o total por mês mostra 1.720 mas o breakdown de famílias
  // exibe apenas 545 (somente os produtos com ORC).
  {
    const produtosComOrc = new Set(orcItems.map(i => i.produtoId));
    const extraProdIds   = new Set<string>();

    for (const v of vendas) {
      if (!produtosComOrc.has(v.produtoId)) extraProdIds.add(v.produtoId);
    }
    for (const key of fctsByKey.keys()) {
      const prodId = key.split("|")[0];
      if (!produtosComOrc.has(prodId)) extraProdIds.add(prodId);
    }

    if (extraProdIds.size > 0) {
      const extraProds = await prisma.produto.findMany({
        where:  { codigo: { in: [...extraProdIds] } },
        select: {
          codigo:    true,
          descricao: true,
          unidades:  { where: { unidadeVendaId }, select: { familia: true }, take: 1 },
        },
      });

      // Vendas extra agrupadas por produto×mês
      const extraVendasByProdMes = new Map<string, number>();
      for (const v of vendas) {
        if (produtosComOrc.has(v.produtoId)) continue;
        const key = `${v.produtoId}|${v.month.toISOString().substring(0, 7)}`;
        extraVendasByProdMes.set(key, (extraVendasByProdMes.get(key) ?? 0) + v.quantidade);
      }

      for (const p of extraProds) {
        const familia   = p.unidades[0]?.familia || "Outros";
        let vendasAnual = 0;
        let fctsAnual   = 0;

        if (!famMesMap.has(familia)) famMesMap.set(familia, new Map());
        const famMes = famMesMap.get(familia)!;

        for (const [key, qty] of extraVendasByProdMes) {
          if (!key.startsWith(`${p.codigo}|`)) continue;
          const mk = key.substring(p.codigo.length + 1);
          if (!famMes.has(mk)) famMes.set(mk, { orc: 0, fcts: 0, vendas: 0 });
          famMes.get(mk)!.vendas += qty;
          vendasAnual += qty;
        }

        for (const [key, fcts] of fctsByKey) {
          if (!key.startsWith(`${p.codigo}|`)) continue;
          const mk = key.substring(p.codigo.length + 1);
          if (!mesMap.has(mk)) mesMap.set(mk, { orc: 0, fcts: 0, vendas: 0 });
          mesMap.get(mk)!.fcts += fcts;
          if (!famMes.has(mk)) famMes.set(mk, { orc: 0, fcts: 0, vendas: 0 });
          famMes.get(mk)!.fcts += fcts;
          fctsAnual += fcts;
        }

        if (vendasAnual === 0 && fctsAnual === 0) continue;

        produtosMap.set(p.codigo, {
          id:          p.codigo,
          codigo:      p.codigo,
          descricao:   p.descricao,
          familia,
          orcAnual:    0,
          fctsAnual,
          vendasAnual,
        });
      }
    }
  }

  // ── Aplica vendas corretas (desacoplado de OrcamentoItems) ─────────────────
  // Substitui as vendas acumuladas no loop acima (per-produto com ORC) pelo total
  // real de VendaMensal por mês, filtrado pelo país (vendas já vêm filtradas).
  // Também cria entradas para meses com VendaMensal mas sem nenhum OrcamentoItem.
  for (const [mk, total] of vendasByMonth) {
    if (!mesMap.has(mk)) mesMap.set(mk, { orc: 0, fcts: 0, vendas: 0 });
    mesMap.get(mk)!.vendas = total;
  }

  const porMes = allMonthKeys.map(mk => ({
    month:            `${mk}-01`,
    orc:              mesMap.get(mk)?.orc    ?? 0,
    fcts:             mesMap.get(mk)?.fcts   ?? 0,
    vendas:           mesMap.get(mk)?.vendas ?? 0,
    submissionStatus: (subByMonth.get(mk) ?? null) as string | null,
  }));

  // Desvio FCST × Vendas A.A. por produto (filtro simétrico mensal), filtrado por país
  const vendaAAMapPais = await fetchVendaAAByProdMonth(unidadeVendaId, startMonth, endMonth, paisIso3);
  const fctsByProdMonthPais = new Map<string, Map<string, number>>();
  for (const [k, fctsVal] of fctsByKey) {
    const sep = k.indexOf("|");
    const prod = k.slice(0, sep), mkF = k.slice(sep + 1);
    if (!fctsByProdMonthPais.has(prod)) fctsByProdMonthPais.set(prod, new Map());
    const mm = fctsByProdMonthPais.get(prod)!;
    mm.set(mkF, (mm.get(mkF) ?? 0) + fctsVal);
  }
  const desvioAAMapPais = computeDesvioAAPorProduto(fctsByProdMonthPais, vendaAAMapPais);

  const produtos = Array.from(produtosMap.values())
    .map(p => ({
      ...p,
      vendaAA:       desvioAAMapPais.get(p.id)?.vendaAA       ?? null,
      fctsForDesvio: desvioAAMapPais.get(p.id)?.fctsForDesvio ?? null,
    }))
    .sort((a, b) => a.familia.localeCompare(b.familia) || a.codigo.localeCompare(b.codigo));

  const familiaMeses = Array.from(famMesMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([familia, mMap]) => ({
      familia,
      porMes: allMonthKeys.map(mk => ({
        month:  `${mk}-01`,
        ...(mMap.get(mk) ?? { orc: 0, fcts: 0, vendas: 0 }),
      })),
    }));

  return { porMes, produtos, familiaMeses };
};
