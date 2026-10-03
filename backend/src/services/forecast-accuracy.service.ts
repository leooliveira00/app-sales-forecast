/**
 * Acurácia e bias do forecast: acurácia por unidade (via AcuraciaSnapshot), produtos com desvio crônico e detalhe mês a mês de um produto.
 * Extraído de forecast.service.ts — reexportado por ele para manter os imports existentes.
 */
import prisma from "../config/prisma.js";
import { appCache } from "../utils/cache.js";
import { getSuccessRunMap } from "./forecast-shared.service.js";

// ── Acurácia por Unidade (últimos N meses fechados) ────────────────────────

/**
 * @param meses       Número de meses fechados a considerar (padrão 3).
 * @param anchorMonth "YYYY-MM" opcional. Ancora a janela no fim deste mês em vez
 *                    do último mês global com dados de vendas.
 * @param forceRefresh Bypassa appCache e snapshot — força live query.
 * @param startMonth  "YYYY-MM" opcional. Limita o início da janela; útil quando o
 *                    período selecionado começa depois do início natural da janela de
 *                    N meses (ex: selecionar Jan-Mar/2025 com meses=3 fica correto,
 *                    mas selecionar Jan-Dez/2025 com meses=3 deve ancorar em Dez/2025
 *                    e startMonth evita calcular meses fora do período).
 */
/** Snapshots mais antigos que este valor são considerados stale. */
const ACURACIA_SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000; // 24 horas

/** Dedup de bg-refresh de acurácia em andamento: chave = "YYYY-MM:meses". */
const acuraciaRefreshInProgress = new Set<string>();

export const getAcuraciaUnidades = async (meses = 3, anchorMonth?: string, forceRefresh = false, startMonth?: string) => {
  // Cache de 5 minutos — dados mudam apenas quando Airflow carrega novos dados
  const cacheKey = `acuracia|${meses}|${anchorMonth ?? "latest"}|${startMonth ?? ""}`;
  if (!forceRefresh) {
    const cached = appCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.data;
  }

  let ref: Date;

  // Último mês com vendas reais — usado como fallback e como clamp para datas futuras.
  // Cacheado por 1h pois só muda quando o Airflow carrega novos dados de venda.
  const LATEST_VENDA_CACHE_KEY = "acuracia:latestVendaMonth";
  let latestVenda: { month: Date } | null;
  const cachedLV = appCache.get(LATEST_VENDA_CACHE_KEY);
  if (!forceRefresh && cachedLV && Date.now() < cachedLV.expiresAt) {
    latestVenda = cachedLV.data as { month: Date };
  } else {
    latestVenda = await prisma.vendaMensal.findFirst({
      orderBy: { month: "desc" },
      select:  { month: true },
    });
    if (latestVenda) appCache.set(LATEST_VENDA_CACHE_KEY, latestVenda, 60 * 60 * 1000);
  }
  if (!latestVenda) return [];

  if (anchorMonth) {
    ref = new Date(`${anchorMonth}-01T00:00:00Z`);
    // Clamp: presets anuais como "2026" produzem endMonth = "2026-12" (futuro).
    // Nesse caso ancora no último mês com dados reais para não gerar janela vazia.
    if (ref > latestVenda.month) {
      ref = latestVenda.month;
    }
  } else {
    ref = latestVenda.month;
  }

  // ── Tenta servir do snapshot pré-computado ──────────────────────────────────
  // Snapshot é válido para janelas padrão (3, 6 ou 12 meses).
  // Se startMonth foi fornecido mas coincide com o início natural da janela
  // (anchorMonth - (meses-1) meses), trata como janela natural e usa o snapshot.
  // Exceção: se ref foi clampado ao latestVenda (ex.: preset anual 2026 com dados
  // só até abril), o startMonth original não representa mais a janela efetiva —
  // o snapshot do ref clampado é o melhor dado disponível e deve ser servido.
  const originalRef    = anchorMonth ? new Date(`${anchorMonth}-01T00:00:00Z`) : latestVenda.month;
  const wasClamped     = originalRef > latestVenda.month;
  const naturalGte     = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - (meses - 1), 1));
  const providedGte    = startMonth ? new Date(`${startMonth}-01T00:00:00Z`) : null;
  const startIsNatural = wasClamped || !providedGte || providedGte.getTime() === naturalGte.getTime();
  if ([3, 6, 12].includes(meses) && !forceRefresh && startIsNatural) {
    const snapRows = await prisma.acuraciaSnapshot.findMany({
      where: { anchorMonth: ref, meses },
    });
    if (snapRows.length > 0) {
      const oldestAllowed = Date.now() - ACURACIA_SNAPSHOT_STALE_MS;
      const isFresh = snapRows.every(r => r.computedAt.getTime() > oldestAllowed);

      // Stale-while-revalidate: serve do snapshot mesmo se stale, atualiza em background
      // apenas quando o anchorMonth é do ano corrente — períodos históricos raramente mudam.
      if (!isFresh && ref.getUTCFullYear() >= new Date().getUTCFullYear()) {
        const bgRef   = ref;
        const bgMeses = meses;
        const dedupKey = `${bgRef.toISOString().substring(0, 7)}:${bgMeses}`;
        if (!acuraciaRefreshInProgress.has(dedupKey)) {
          acuraciaRefreshInProgress.add(dedupKey);
          void (async () => {
            try {
              const freshData = await getAcuraciaUnidades(bgMeses, anchorMonth, true) as Array<{
                codigo: string; acuracia: number; bias: number; ciclosValidos: number; totalVendas: number;
              }>;
              if (freshData.length === 0) return;
              const now = new Date();
              await prisma.$transaction(
                freshData.map(u => prisma.acuraciaSnapshot.upsert({
                  where:  { unidadeVendaId_anchorMonth_meses: { unidadeVendaId: u.codigo, anchorMonth: bgRef, meses: bgMeses } },
                  create: { unidadeVendaId: u.codigo, anchorMonth: bgRef, meses: bgMeses, acuracia: u.acuracia, bias: u.bias, ciclosValidos: u.ciclosValidos, totalVendas: u.totalVendas, computedAt: now },
                  update: { acuracia: u.acuracia, bias: u.bias, ciclosValidos: u.ciclosValidos, totalVendas: u.totalVendas, computedAt: now },
                }))
              );
              console.log(`[snapshot] bg-refresh acuracia ${bgRef.toISOString().substring(0, 7)} meses=${bgMeses} — ${freshData.length} rows`);
            } catch (err) {
              console.error('[snapshot] bg-refresh (getAcuraciaUnidades) failed:', err);
            } finally {
              acuraciaRefreshInProgress.delete(dedupKey);
            }
          })();
        }
      }

      // Sempre serve do snapshot (fresco ou stale)
      const unitDescs = await prisma.unidadeVenda.findMany({
        where:  { ativo: true },
        select: { codigo: true, descricao: true },
      });
      const unitDescMap = new Map(unitDescs.map(u => [u.codigo, u.descricao]));
      const results = snapRows
        .filter(r => unitDescMap.has(r.unidadeVendaId))
        .map(r => ({
          codigo:        r.unidadeVendaId,
          descricao:     unitDescMap.get(r.unidadeVendaId) ?? "",
          acuracia:      parseFloat(r.acuracia.toString()),
          bias:          parseFloat(r.bias.toString()),
          ciclosValidos: r.ciclosValidos,
          totalVendas:   r.totalVendas ? parseFloat(r.totalVendas.toString()) : 0,
        }));
      appCache.set(cacheKey, results, 5 * 60 * 1000);
      return results;
    }
  }
  // ── Fim do bloco de snapshot — snapRows.length === 0 ou forceRefresh, executa query ao vivo ─

  const lt  = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
  // Se startMonth fornecido, a janela começa exatamente nele (ignora meses).
  // Caso contrário, usa os últimos N meses a partir de ref.
  const effectiveGte = startMonth
    ? new Date(`${startMonth}-01T00:00:00Z`)
    : new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - (meses - 1), 1));

  const monthKeys: string[] = [];
  for (let d = new Date(effectiveGte); d < lt; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    monthKeys.push(d.toISOString().substring(0, 7));
  }

  // Busca runs SUCCESS com refMonth — necessário para cruzar com aprovações por unidade
  const allSuccessRuns = await prisma.forecastRun.findMany({
    where:  { status: "SUCCESS" },
    select: { id: true, refMonth: true, executedAt: true },
  });
  const runInfoMap    = new Map(allSuccessRuns.map(r => [r.id, r]));
  const successRunIds = allSuccessRuns.map(r => r.id);

  // Apenas ciclos com DivisionSubmission APPROVED entram na acurácia —
  // alinha com o mesmo critério do Consolidado (orcamento.service.ts).
  const approvedSubs = await prisma.divisionSubmission.findMany({
    where:  { status: "APPROVED" },
    select: { refMonth: true, unidadeVendaId: true },
  });
  // Set de "unidadeVendaId|refMonthISO" aprovados
  const approvedKey = new Set(
    approvedSubs.map(s => `${s.unidadeVendaId}|${s.refMonth.toISOString()}`)
  );

  // Dispara queries independentes em paralelo
  const [unidades, vendasAll, forecastItems] = await Promise.all([
    prisma.unidadeVenda.findMany({
      where:  { ativo: true },
      select: { codigo: true, descricao: true, tipo: true },
    }),
    prisma.vendaMensal.findMany({
      where:  { month: { gte: effectiveGte, lt } },
      select: { unidadeVendaId: true, month: true, quantidade: true },
    }),
    // Inclui paisIso3 para filtrar por tipo de unidade:
    // EXPORT → itens por país (paisIso3 != null); NACIONAL → itens agregados (paisIso3 = null)
    prisma.forecastItem.findMany({
      where:  { month: { gte: effectiveGte, lt }, runId: { in: successRunIds } },
      select: { id: true, runId: true, unidadeVendaId: true, month: true, paisIso3: true },
    }),
  ]);

  // Mapa tipo da unidade para filtrar FCTS corretamente
  const unitTipoMap = new Map(unidades.map((u) => [u.codigo, u.tipo]));

  // 1 query para todos os overrides (substitui N subqueries por item)
  const overridesMap = new Map<string, number>(
    (await prisma.forecastOverride.findMany({
      where:  { forecastItemId: { in: forecastItems.map((i) => i.id) } },
      select: { forecastItemId: true, volumeFCTS: true },
    })).map((o) => [o.forecastItemId, o.volumeFCTS])
  );

  const vendasMap = new Map<string, number>();
  for (const v of vendasAll) {
    const mk  = v.month.toISOString().substring(0, 7);
    const key = `${v.unidadeVendaId}|${mk}`;
    vendasMap.set(key, (vendasMap.get(key) ?? 0) + v.quantidade);
  }

  const latestRun = new Map<string, { runId: string; executedAt: Date }>();
  for (const item of forecastItems) {
    const run = runInfoMap.get(item.runId);
    if (!run) continue;
    // Só contabiliza FCTS de ciclos aprovados para essa unidade
    if (!approvedKey.has(`${item.unidadeVendaId}|${run.refMonth.toISOString()}`)) continue;
    const mk     = item.month.toISOString().substring(0, 7);
    const key    = `${item.unidadeVendaId}|${mk}`;
    const cur    = latestRun.get(key);
    if (!cur || run.executedAt > cur.executedAt)
      latestRun.set(key, { runId: item.runId, executedAt: run.executedAt });
  }

  const fctsMap = new Map<string, number>();
  for (const item of forecastItems) {
    const isExport = unitTipoMap.get(item.unidadeVendaId) === 'EXPORT';
    // EXPORT → somente itens por país; NACIONAL → somente itens agregados
    if (isExport  && item.paisIso3 === null) continue;
    if (!isExport && item.paisIso3 !== null) continue;
    const mk  = item.month.toISOString().substring(0, 7);
    const key = `${item.unidadeVendaId}|${mk}`;
    if (item.runId !== latestRun.get(key)?.runId) continue;
    fctsMap.set(key, (fctsMap.get(key) ?? 0) + (overridesMap.get(item.id) ?? 0));
  }

  const results = unidades.flatMap((u) => {
    const pontos = monthKeys
      .map((mk) => {
        const key = `${u.codigo}|${mk}`;
        return { fcts: fctsMap.get(key) ?? 0, vendas: vendasMap.get(key) ?? 0 };
      })
      .filter((p) => p.fcts > 0 && p.vendas > 0);

    if (pontos.length === 0) return [];

    const totalVendas  = pontos.reduce((s, p) => s + p.vendas, 0);
    const totalAbsErro = pontos.reduce((s, p) => s + Math.abs(p.fcts - p.vendas), 0);
    // WAPE: acurácia ponderada pelo volume — erro absoluto total / vendas total
    const acuracia = Math.max(0, Math.min(100, (1 - totalAbsErro / totalVendas) * 100));
    const totalFcts       = pontos.reduce((s, p) => s + p.fcts,   0);
    const totalVendasBias = pontos.reduce((s, p) => s + p.vendas, 0);
    const bias = totalVendasBias > 0
      ? ((totalFcts - totalVendasBias) / totalVendasBias) * 100
      : 0;

    return [
      {
        codigo: u.codigo,
        descricao: u.descricao,
        acuracia: parseFloat(acuracia.toFixed(1)),
        bias: parseFloat(bias.toFixed(1)),
        ciclosValidos: pontos.length,
        totalVendas,
      },
    ];
  });

  appCache.set(cacheKey, results, 5 * 60 * 1000);
  return results;
};

// ── Produtos Crónicos (SKUs com desvio persistente em N ciclos) ────────────

export const getProdutosCronicos = async (
  unidadeVendaId?: string,
  ciclos = 3,
  threshold = 15
) => {
  // Cache de 5 minutos para a chamada global (dashboard admin) — sem unidadeVendaId
  const cacheKey = unidadeVendaId
    ? null
    : `cronicos|${ciclos}|${threshold}`;
  if (cacheKey) {
    const cached = appCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.data;
  }

  // Ancora a janela no último mês com dados reais de vendas — assim o sistema
  // avança automaticamente quando novos dados chegam, independente do clock.
  const latestVendaRow = await prisma.vendaMensal.findFirst({
    where: unidadeVendaId ? { unidadeVendaId } : {},
    orderBy: { month: "desc" },
    select: { month: true },
  });

  if (!latestVendaRow) return [];

  const refMonth = latestVendaRow.month; // ex: 2026-02-01
  // Janela: [refMonth - (ciclos) meses, refMonth] inclusive → "ciclos + 1" slots
  const lt  = new Date(Date.UTC(refMonth.getUTCFullYear(), refMonth.getUTCMonth() + 1, 1));
  const gte = new Date(Date.UTC(refMonth.getUTCFullYear(), refMonth.getUTCMonth() - ciclos, 1));

  const runMap        = await getSuccessRunMap();
  const successRunIds = [...runMap.keys()];

  // Determina tipo da(s) unidade(s) para filtro correto de paisIso3
  // Unidades EXPORT: FCTS definido por país (paisIso3 != null); NACIONAL: agregado (paisIso3 = null)
  const unidade = unidadeVendaId
    ? await prisma.unidadeVenda.findUnique({
        where:  { codigo: unidadeVendaId },
        select: { tipo: true },
      })
    : null;
  const isExport = unidade?.tipo === "EXPORT";

  // View global: mapa de quais unidades são EXPORT (para filtragem em memória)
  const exportSet = !unidadeVendaId
    ? new Set(
        (await prisma.unidadeVenda.findMany({ select: { codigo: true, tipo: true } }))
          .filter((u) => u.tipo === "EXPORT")
          .map((u) => u.codigo)
      )
    : null;

  // Dispara queries independentes em paralelo (sem include overrides — elimina N+1)
  const [forecastItems, vendasAll] = await Promise.all([
    prisma.forecastItem.findMany({
      where: {
        ...(unidadeVendaId ? { unidadeVendaId } : {}),
        month:          { gte, lt },
        runId:          { in: successRunIds },
        gestorExcluido: false,
        // NACIONAL: paisIso3=null | EXPORT: por país (not null) | global: sem filtro (memória)
        ...(unidadeVendaId
          ? isExport ? { paisIso3: { not: null } } : { paisIso3: null }
          : {}),
      },
      select: {
        id:             true,
        runId:          true,
        unidadeVendaId: true,
        produtoId:      true,
        month:          true,
        paisIso3:       true,
        produto: {
          select: {
            codigo:    true,
            descricao: true,
            classe:    true,
            unidades:  { select: { familia: true, unidadeVendaId: true } },
          },
        },
      },
    }),
    prisma.vendaMensal.findMany({
      where: {
        ...(unidadeVendaId ? { unidadeVendaId } : {}),
        month: { gte, lt },
      },
      select: { unidadeVendaId: true, produtoId: true, month: true, quantidade: true },
    }),
  ]);

  // 1 query para todos os overrides (substitui N subqueries por item)
  const overridesMap = new Map<string, number>(
    (await prisma.forecastOverride.findMany({
      where:  { forecastItemId: { in: forecastItems.map((i) => i.id) } },
      select: { forecastItemId: true, volumeFCTS: true },
    })).map((o) => [o.forecastItemId, o.volumeFCTS])
  );

  const vendasMap = new Map<string, number>();
  for (const v of vendasAll) {
    const mk  = v.month.toISOString().substring(0, 7);
    const key = `${v.unidadeVendaId}|${v.produtoId}|${mk}`;
    vendasMap.set(key, (vendasMap.get(key) ?? 0) + v.quantidade);
  }

  const latestRun   = new Map<string, string>();
  const latestRunAt = new Map<string, Date>();
  for (const item of forecastItems) {
    const mk     = item.month.toISOString().substring(0, 7);
    const key    = `${item.unidadeVendaId}|${mk}`;
    const execAt = runMap.get(item.runId) ?? new Date(0);
    const cur    = latestRunAt.get(key);
    if (!cur || execAt > cur) {
      latestRun.set(key, item.runId);
      latestRunAt.set(key, execAt);
    }
  }

  type ProdMonth = { month: string; fcts: number; vendas: number; desvio: number };
  type ProdEntry = {
    unidadeVendaId: string;
    codigo: string;
    descricao: string;
    classe: string | null;
    familia: string | null;
    meses: ProdMonth[];
  };

  const productData = new Map<string, ProdEntry>();

  // Mapa intermediário para agregar FCTS de múltiplos países (unidades EXPORT)
  // key = `${unidadeVendaId}|${produtoId}|${mk}`
  type AggEntry = { fcts: number; itemRef: (typeof forecastItems)[0] };
  const fctsByProdMonth = new Map<string, AggEntry>();

  for (const item of forecastItems) {
    const mk     = item.month.toISOString().substring(0, 7);
    const unitMk = `${item.unidadeVendaId}|${mk}`;
    if (item.runId !== latestRun.get(unitMk)) continue;

    // View global: filtragem em memória por tipo de unidade
    // — EXPORT: usa apenas itens por país (paisIso3 != null), ignora legados (paisIso3 = null)
    // — NACIONAL: usa apenas itens agregados (paisIso3 = null)
    if (!unidadeVendaId && exportSet) {
      const unitIsExport = exportSet.has(item.unidadeVendaId);
      if (unitIsExport  && item.paisIso3 === null) continue;
      if (!unitIsExport && item.paisIso3 !== null) continue;
    }

    const fcts   = overridesMap.get(item.id) ?? 0;
    const aggKey = `${item.unidadeVendaId}|${item.produtoId}|${mk}`;
    const curr   = fctsByProdMonth.get(aggKey);
    fctsByProdMonth.set(aggKey, {
      fcts:    (curr?.fcts ?? 0) + fcts,
      itemRef: item,
    });
  }

  // Calcula desvio com FCTS já agregado por (unidade, produto, mês)
  for (const [aggKey, { fcts, itemRef }] of fctsByProdMonth.entries()) {
    if (fcts === 0) continue; // sem forecast → irrelevante

    const parts  = aggKey.split("|");
    const uId    = parts[0];
    const prodId = parts[1];
    const mk     = parts[2];

    const vendas  = vendasMap.get(`${uId}|${prodId}|${mk}`) ?? 0;
    // Quando não houve nenhuma venda, atingimento = 0 % (desvio = 100)
    const desvio  = vendas === 0 ? 100 : ((fcts / vendas) - 1) * 100;
    const prodKey = `${uId}|${prodId}`;

    if (!productData.has(prodKey)) {
      const familia =
        itemRef.produto.unidades.find((u) => u.unidadeVendaId === uId)?.familia ?? null;
      productData.set(prodKey, {
        unidadeVendaId: uId,
        codigo:    itemRef.produto.codigo,
        descricao: itemRef.produto.descricao,
        classe:    itemRef.produto.classe,
        familia,
        meses: [],
      });
    }

    productData.get(prodKey)!.meses.push({
      month:  mk,
      fcts,
      vendas,
      desvio: parseFloat(desvio.toFixed(1)),
    });
  }

  const cronicos: Array<{
    unidadeVendaId: string;
    produtoCodigo: string;
    produtoDescricao: string;
    classe: string | null;
    familia: string | null;
    direcao: "alta" | "baixa";
    desvioMedio: number;
    historico: ProdMonth[];
  }> = [];

  for (const [, data] of productData.entries()) {
    const sorted = [...data.meses].sort((a, b) => a.month.localeCompare(b.month));
    const recent = sorted.slice(-ciclos);
    if (recent.length < ciclos) continue;
    if (!recent.every((m) => Math.abs(m.desvio) > threshold)) continue;

    const desvioMedio = recent.reduce((s, m) => s + m.desvio, 0) / recent.length;
    cronicos.push({
      unidadeVendaId:   data.unidadeVendaId,
      produtoCodigo:    data.codigo,
      produtoDescricao: data.descricao,
      classe:           data.classe,
      familia:          data.familia,
      direcao:          desvioMedio > 0 ? "alta" : "baixa",
      desvioMedio:      parseFloat(desvioMedio.toFixed(1)),
      historico:        recent,
    });
  }

  const result = cronicos.sort((a, b) => Math.abs(b.desvioMedio) - Math.abs(a.desvioMedio));

  if (cacheKey) {
    appCache.set(cacheKey, result, 5 * 60 * 1000);
  }
  return result;
};

// ── getProdutoMeses: 12 meses de ORC × FCTS × Vendas para um único produto ──

export const getProdutoMeses = async (
  unidadeVendaId: string,
  produtoId:      string,
  startMonth?:    string,
  endMonth?:      string,
  paisIso3?:      string,
) => {
  let gte: Date;
  let lt: Date;
  let monthKeys: string[];

  if (startMonth && endMonth) {
    // Usa a janela explicitamente fornecida (mesmo intervalo do WindowSelector)
    gte = new Date(`${startMonth}-01T00:00:00Z`);
    const endDate = new Date(`${endMonth}-01T00:00:00Z`);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);
    lt = endDate;
    const cur = new Date(gte);
    monthKeys = [];
    while (cur < lt) {
      monthKeys.push(cur.toISOString().substring(0, 7));
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  } else {
    // Comportamento original: ancora nos últimos 12 meses desde a última venda do produto
    const latestVenda = await prisma.vendaMensal.findFirst({
      where:   { unidadeVendaId, produtoId },
      orderBy: { month: "desc" },
      select:  { month: true },
    });
    if (!latestVenda) return [];
    const ref = latestVenda.month;
    lt  = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
    gte = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 11, 1));
    monthKeys = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - i, 1));
      monthKeys.push(d.toISOString().substring(0, 7));
    }
  }

  // Filtro orcamentoAno para evitar inflar ORC com runs de anos diferentes
  const startYear     = parseInt(monthKeys[0].substring(0, 4), 10);
  const endYear       = parseInt(monthKeys[monthKeys.length - 1].substring(0, 4), 10);
  const orcAnosNeeded = startYear !== endYear ? [startYear, endYear] : [endYear];

  // ORC — quando paisIso3 fornecido, filtra por país; caso contrário soma todos (unit total)
  const orcItems = await prisma.orcamentoItem.findMany({
    where: {
      unidadeVendaId,
      produtoId,
      month:        { gte, lt },
      orcamentoAno: { in: orcAnosNeeded },
      ...(paisIso3 ? { paisIso3 } : {}),
    },
    select: { month: true, volumeORC: true },
  });
  const orcByMonth = new Map<string, number>();
  for (const o of orcItems) {
    const mk = o.month.toISOString().substring(0, 7);
    orcByMonth.set(mk, (orcByMonth.get(mk) ?? 0) + o.volumeORC);
  }

  // Vendas — filtro por país quando fornecido
  const vendas = await prisma.vendaMensal.findMany({
    where: {
      unidadeVendaId,
      produtoId,
      month: { gte, lt },
      ...(paisIso3 ? { paisIso3 } : {}),
    },
    select: { month: true, quantidade: true },
  });
  const vendasByMonth = new Map<string, number>();
  for (const v of vendas) {
    const mk = v.month.toISOString().substring(0, 7);
    vendasByMonth.set(mk, (vendasByMonth.get(mk) ?? 0) + v.quantidade);
  }

  // FCTS — apenas ciclos aprovados (DivisionSubmission APPROVED) para a unidade
  const approvedSubsForUnit = await prisma.divisionSubmission.findMany({
    where:  { unidadeVendaId, status: "APPROVED" },
    select: { refMonth: true },
  });
  const approvedRefMonths = new Set(approvedSubsForUnit.map(s => s.refMonth.toISOString()));

  const approvedRuns = await prisma.forecastRun.findMany({
    where:  { status: "SUCCESS", refMonth: { in: [...approvedRefMonths].map(r => new Date(r)) } },
    select: { id: true, executedAt: true },
  });
  const runExecMap    = new Map<string, Date>(approvedRuns.map((r) => [r.id, r.executedAt]));
  const approvedRunIds = approvedRuns.map((r) => r.id);

  // Quando paisIso3 fornecido → filtra itens por país; caso contrário → itens null (total da unidade)
  const fctItems = await prisma.forecastItem.findMany({
    where: {
      produtoId,
      unidadeVendaId,
      paisIso3:       paisIso3 ?? null,
      month:          { gte, lt },
      runId:          { in: approvedRunIds },
      gestorExcluido: false,
    },
    include: { overrides: { take: 1, orderBy: { updatedAt: "desc" } } },
  });

  // Dedup: run aprovado mais recente por mês (apenas itens null = total da unidade)
  const latestRunPerKey = new Map<string, { runId: string; executedAt: Date }>();
  for (const item of fctItems) {
    const mk     = item.month.toISOString().substring(0, 7);
    const execAt = runExecMap.get(item.runId) ?? new Date(0);
    const cur    = latestRunPerKey.get(mk);
    if (!cur || execAt > cur.executedAt) latestRunPerKey.set(mk, { runId: item.runId, executedAt: execAt });
  }

  const fctsByMonth = new Map<string, number>();
  for (const item of fctItems) {
    const mk = item.month.toISOString().substring(0, 7);
    if (item.runId !== latestRunPerKey.get(mk)?.runId) continue;
    fctsByMonth.set(mk, (fctsByMonth.get(mk) ?? 0) + (item.overrides[0]?.volumeFCTS ?? 0));
  }

  return monthKeys.map((mk) => ({
    month:  `${mk}-01`,
    orc:    orcByMonth.get(mk)    ?? 0,
    fcts:   fctsByMonth.get(mk)   ?? 0,
    vendas: vendasByMonth.get(mk) ?? 0,
  }));
};
