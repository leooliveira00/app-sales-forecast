/**
 * Leitura de ForecastItems para as telas do gestor: itens por unidade/run/mês alvo e visão anual (com cache).
 * Extraído de forecast.service.ts — reexportado por ele para manter os imports existentes.
 */
import prisma from "../config/prisma.js";
import { appCache } from "../utils/cache.js";

// ── ForecastItem ───────────────────────────────────────────────────────────

/**
 * Retorna os itens de forecast para uma unidade, run e mês alvo específicos.
 *
 * @param unidadeVendaId  ID da unidade de venda
 * @param refMonth        Mês do ciclo (ForecastRun.refMonth) — ex.: "2026-03-01"
 * @param targetMonth     Mês alvo dentro da janela   — ex.: "2026-05-01"
 * @param runId           (Opcional) ID do run, para evitar query extra
 *
 * Retrocompatibilidade: se targetMonth não for fornecido, usa refMonth.
 */
export const getItemsForUnit = async (
  unidadeVendaId: string,
  refMonth: string,
  runId?: string,
  targetMonth?: string
) => {
  let targetRunId = runId;
  let run: { id: string; windowStart: Date | null; windowEnd: Date | null; leadTimeMonths: number } | null = null;

  if (!targetRunId) {
    run = await prisma.forecastRun.findFirst({
      where: { refMonth: new Date(refMonth), status: "SUCCESS" },
      orderBy: { executedAt: "desc" },
      select: { id: true, windowStart: true, windowEnd: true, leadTimeMonths: true },
    });
    if (!run) return { run: null, items: [] };
    targetRunId = run.id;
  } else {
    run = await prisma.forecastRun.findUnique({
      where: { id: targetRunId },
      select: { id: true, windowStart: true, windowEnd: true, leadTimeMonths: true },
    });
  }

  // Resolve o mês alvo: usa targetMonth se fornecido, senão usa refMonth (retrocompat.)
  const resolvedTargetMonth = targetMonth ? new Date(targetMonth) : new Date(refMonth);

  // Mês anterior para buscar prevRun em paralelo
  const prevRefMonth = new Date(refMonth);
  prevRefMonth.setUTCMonth(prevRefMonth.getUTCMonth() - 1);

  const currentRefMonth = new Date(refMonth);
  const twelveMonthsAgo = new Date(currentRefMonth);
  twelveMonthsAgo.setUTCMonth(twelveMonthsAgo.getUTCMonth() - 12);

  // Dispara todas as queries independentes em paralelo
  const [items, orcItems, windowOrcItemsRaw, rawSalesHistory, rawOrcHistory, prevRun] =
    await Promise.all([
      prisma.forecastItem.findMany({
        where: { runId: targetRunId, unidadeVendaId, month: resolvedTargetMonth },
        include: {
          produto: {
            include: {
              unidades: {
                where: { unidadeVendaId },
                take: 1,
                select: { familia: true, divisao: true },
              },
            },
          },
          overrides: { take: 1 },
          pais: true,
        },
        orderBy: [{ paisIso3: "asc" }, { produto: { descricao: "asc" } }],
      }),

      prisma.orcamentoItem.findMany({
        where: { unidadeVendaId, month: resolvedTargetMonth },
        select: { produtoId: true, paisIso3: true, volumeORC: true },
      }),

      run?.windowStart && run?.windowEnd
        ? prisma.orcamentoItem.findMany({
            where: { unidadeVendaId, month: { gte: run.windowStart, lte: run.windowEnd } },
            select: { produtoId: true, paisIso3: true },
          })
        : Promise.resolve([] as { produtoId: string; paisIso3: string | null }[]),

      prisma.vendaMensal.groupBy({
        by: ["produtoId", "month"],
        where: { unidadeVendaId, month: { gte: twelveMonthsAgo, lt: currentRefMonth } },
        _sum: { quantidade: true },
        orderBy: { month: "asc" },
      }),

      prisma.orcamentoItem.findMany({
        where: {
          unidadeVendaId,
          month: { gte: twelveMonthsAgo, lt: currentRefMonth },
          paisIso3: null,
        },
        select: { produtoId: true, month: true, volumeORC: true },
        orderBy: { month: "asc" },
      }),

      prisma.forecastRun.findFirst({
        where: { refMonth: prevRefMonth, status: "SUCCESS" },
        orderBy: { executedAt: "desc" },
        select: { id: true },
      }),
    ]);

  const orcMap = new Map(
    orcItems.map((o) => [`${o.produtoId}_${o.paisIso3 ?? ""}`, o.volumeORC])
  );

  const windowOrcKeys = new Set<string>(
    windowOrcItemsRaw.map((o) => `${o.produtoId}_${o.paisIso3 ?? ""}`)
  );

  const salesByProduct = new Map<string, { month: Date; qty: number }[]>();
  rawSalesHistory.forEach((s) => {
    const arr = salesByProduct.get(s.produtoId) ?? [];
    arr.push({ month: s.month, qty: s._sum.quantidade ?? 0 });
    salesByProduct.set(s.produtoId, arr);
  });

  const orcHistoryByProduct = new Map<string, { month: Date; orc: number }[]>();
  rawOrcHistory.forEach((o) => {
    const arr = orcHistoryByProduct.get(o.produtoId) ?? [];
    arr.push({ month: o.month, orc: o.volumeORC });
    orcHistoryByProduct.set(o.produtoId, arr);
  });

  // Chave: "produtoId_paisIso3" (vazio para NACIONAL)
  const prevFctsMap = new Map<string, number>();
  const windowPrevFctsKeys = new Set<string>();

  if (prevRun) {
    const [prevItems, prevWindowItems] = await Promise.all([
      prisma.forecastItem.findMany({
        where: { runId: prevRun.id, unidadeVendaId, month: resolvedTargetMonth },
        select: {
          produtoId: true,
          paisIso3: true,
          overrides: { take: 1, orderBy: { updatedAt: "desc" } },
        },
      }),
      run?.windowStart && run?.windowEnd
        ? prisma.forecastItem.findMany({
            where: {
              runId: prevRun.id,
              unidadeVendaId,
              month: { gte: run.windowStart, lte: run.windowEnd },
              overrides: { some: {} },
            },
            select: { produtoId: true, paisIso3: true },
          })
        : Promise.resolve([] as { produtoId: string; paisIso3: string | null }[]),
    ]);

    prevItems.forEach((pi) => {
      if (pi.overrides[0]?.volumeFCTS != null) {
        prevFctsMap.set(`${pi.produtoId}_${pi.paisIso3 ?? ""}`, pi.overrides[0].volumeFCTS);
      }
    });
    prevWindowItems.forEach((pi) => {
      windowPrevFctsKeys.add(`${pi.produtoId}_${pi.paisIso3 ?? ""}`);
    });
  }

  const enrichedItems = items.map((item) => {
    const history = salesByProduct.get(item.produtoId) ?? [];
    const last3 = history.slice(-3);
    const last6 = history.slice(-6);
    const avgTrim = last3.length
      ? Math.round(last3.reduce((s, h) => s + h.qty, 0) / last3.length)
      : null;
    const avgSem = last6.length
      ? Math.round(last6.reduce((s, h) => s + h.qty, 0) / last6.length)
      : null;
    const avg12m = history.length
      ? Math.round(history.reduce((s, h) => s + h.qty, 0) / history.length)
      : null;

    const prevFCTS  = prevFctsMap.get(`${item.produtoId}_${item.paisIso3 ?? ""}`) ?? null;
    const volumeORC = orcMap.get(`${item.produtoId}_${item.paisIso3 ?? ""}`) ?? null;

    // Portfólio padrão: produto adicionado manualmente, com ORC ou prevFCTS no mês alvo
    // OU com ORC/prevFCTS em qualquer outro mês da janela do ciclo.
    // Isso garante que o último mês (sem ORC próprio) exiba os mesmos produtos
    // dos demais meses, sem trazer resíduos de produtos descontinuados.
    const key = `${item.produtoId}_${item.paisIso3 ?? ""}`;
    const isDefaultPortfolio =
      item.source === "MANUAL" ||
      item.source === "PREVIOUS_CYCLE" ||
      volumeORC !== null ||
      prevFCTS !== null ||
      windowOrcKeys.has(key) ||
      windowPrevFctsKeys.has(key);

    return {
      ...item,
      prevFCTS,
      volumeORC,
      isDefaultPortfolio,
      avgTrim,
      avgSem,
      avg12m,
      salesHistory: history.map((h) => ({
        month: h.month.toISOString(),
        qty: h.qty,
      })),
      orcHistory: (orcHistoryByProduct.get(item.produtoId) ?? []).map((o) => ({
        month: o.month.toISOString(),
        volumeORC: o.orc,
      })),
    };
  });

  return {
    run: run ? { windowStart: run.windowStart, windowEnd: run.windowEnd, leadTimeMonths: run.leadTimeMonths } : null,
    items: enrichedItems,
  };
};

// ── Visão Anual: todos os meses do ciclo em uma única chamada ────────────────

/**
 * Retorna todos os ForecastItems de um ciclo para uma unidade, agrupados por produto.
 * Cada produto contém um array de 12 (ou N) entradas mensais com ORC, IA, override e vendaAA.
 * Usado pela visão de preenchimento anual em MeuForecastPage.
 */
export const getForecastItemsAnnual = async (
  unidadeVendaId: string,
  refMonth: string,
  paisIso3Filter?: string | null
) => {
  const cacheKey = `annual|${unidadeVendaId}|${refMonth}|${paisIso3Filter ?? ""}`;
  const cached = appCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const run = await prisma.forecastRun.findFirst({
    where:   { refMonth: new Date(refMonth), status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
    select:  { id: true, windowStart: true, windowEnd: true, leadTimeMonths: true, refMonth: true },
  });
  if (!run) {
    const empty = { run: null, products: [] };
    appCache.set(cacheKey, empty, 2 * 60 * 1000);
    return empty;
  }

  // Todos os itens do run para a unidade (todos os meses).
  // Quando paisIso3Filter for informado, restringe ao país específico.
  // Nota: não incluir `unidades` no include principal — nested where+take em datasets grandes
  // causa panic no Prisma query engine. familia é buscada separadamente abaixo.
  const items = await prisma.forecastItem.findMany({
    where:   {
      runId: run.id,
      unidadeVendaId,
      ...(paisIso3Filter ? { OR: [{ paisIso3: paisIso3Filter }, { paisIso3: null }] } : {}),
    },
    include: {
      produto: {
        select: { codigo: true, descricao: true, classe: true },
      },
    },
    orderBy: [{ month: "asc" }, { paisIso3: "asc" }],
  });

  // Ordena por descricao em memória para evitar orderBy em relação (trigger do panic no Prisma)
  items.sort((a, b) => {
    const ma = a.month.getTime(), mb = b.month.getTime();
    if (ma !== mb) return ma - mb;
    const pa = a.paisIso3 ?? "", pb = b.paisIso3 ?? "";
    if (pa !== pb) return pa.localeCompare(pb);
    return a.produto.descricao.localeCompare(b.produto.descricao);
  });

  // Busca familia separadamente para evitar o panic do Prisma com nested where+take
  const uniqueProdutoIds = [...new Set(items.map(i => i.produtoId))];
  const familiaLinks = uniqueProdutoIds.length > 0
    ? await prisma.produtoUnidadeVenda.findMany({
        where:  { unidadeVendaId, produtoId: { in: uniqueProdutoIds } },
        select: { produtoId: true, familia: true },
      })
    : [];
  const familiaByProduto = new Map(familiaLinks.map(l => [l.produtoId, l.familia ?? null]));

  if (items.length === 0) {
    const empty = { run: { windowStart: run.windowStart, windowEnd: run.windowEnd, leadTimeMonths: run.leadTimeMonths }, products: [] };
    appCache.set(cacheKey, empty, 2 * 60 * 1000);
    return empty;
  }

  // Determina janela real a partir dos meses dos itens
  const monthDates = items.map(i => i.month.getTime());
  const windowGte  = new Date(Math.min(...monthDates));
  const windowLte  = new Date(Math.max(...monthDates));

  // Janela do ano anterior para vendaAA
  const vendaAAGte = new Date(windowGte);
  vendaAAGte.setUTCFullYear(vendaAAGte.getUTCFullYear() - 1);
  const vendaAALte = new Date(windowLte);
  vendaAALte.setUTCFullYear(vendaAALte.getUTCFullYear() - 1);

  // Janela histórica para salesHistory / orcHistory (12 meses antes do refMonth)
  const currentRef     = new Date(refMonth);
  const twelveMonthsAgo = new Date(currentRef);
  twelveMonthsAgo.setUTCMonth(twelveMonthsAgo.getUTCMonth() - 12);

  // Run anterior (ciclo N-1) para prevFCTS
  const prevRefMonth = new Date(refMonth);
  prevRefMonth.setUTCMonth(prevRefMonth.getUTCMonth() - 1);

  const allItemIds = items.map(i => i.id);

  const [overrides, orcItems, vendasAA, rawSalesHistory, rawOrcHistory, prevRun, historicalFctsItems] =
    await Promise.all([
      prisma.forecastOverride.findMany({
        where:  { forecastItemId: { in: allItemIds } },
        select: { forecastItemId: true, id: true, volumeFCTS: true },
      }),
      prisma.orcamentoItem.findMany({
        where:  { unidadeVendaId, month: { gte: windowGte, lte: windowLte } },
        select: { produtoId: true, paisIso3: true, month: true, volumeORC: true },
      }),
      prisma.vendaMensal.findMany({
        where:  { unidadeVendaId, month: { gte: vendaAAGte, lte: vendaAALte }, ...(paisIso3Filter != null ? { paisIso3: paisIso3Filter } : {}) },
        select: { produtoId: true, paisIso3: true, month: true, quantidade: true },
      }),
      prisma.vendaMensal.groupBy({
        by:      ["produtoId", "month"],
        where:   { unidadeVendaId, month: { gte: twelveMonthsAgo, lt: currentRef }, ...(paisIso3Filter != null ? { paisIso3: paisIso3Filter } : {}) },
        _sum:    { quantidade: true },
        orderBy: { month: "asc" },
      }),
      prisma.orcamentoItem.findMany({
        where:   {
          unidadeVendaId,
          month: { gte: twelveMonthsAgo, lt: currentRef },
          ...(paisIso3Filter != null ? { paisIso3: paisIso3Filter } : { paisIso3: null }),
        },
        select:  { produtoId: true, month: true, volumeORC: true },
        orderBy: { month: "asc" },
      }),
      prisma.forecastRun.findFirst({
        where:   { refMonth: prevRefMonth, status: "SUCCESS" },
        orderBy: { executedAt: "desc" },
        select:  { id: true },
      }),
      // IDs dos ForecastItems históricos — overrides buscados separadamente abaixo
      // para evitar nested take:1 em datasets grandes (causa panic no Prisma query engine)
      prisma.forecastItem.findMany({
        where:  {
          unidadeVendaId,
          month: { gte: twelveMonthsAgo, lt: currentRef },
          ...(paisIso3Filter != null ? { paisIso3: paisIso3Filter } : {}),
        },
        select: {
          id:        true,
          produtoId: true,
          month:     true,
          runId:     true,
          run:       { select: { executedAt: true } },
        },
      }),
    ]);

  // ── Mapas de lookup ────────────────────────────────────────────────────────
  const overrideMap = new Map(
    overrides.map(o => [o.forecastItemId, { id: o.id, volumeFCTS: o.volumeFCTS }])
  );

  // "produtoId_paisIso3_YYYY-MM" → volumeORC
  const orcMap = new Map<string, number>();
  for (const o of orcItems) {
    const mk = o.month.toISOString().substring(0, 7);
    orcMap.set(`${o.produtoId}_${o.paisIso3 ?? ""}_${mk}`, o.volumeORC);
  }

  // vendaAA: somar por produtoId + paisIso3 + mês corrente (mês do ano anterior + 1 ano).
  // Inclui paisIso3 na chave para que cada item EXPORT (BRA/ARG/MEX) receba só
  // a venda AA do seu próprio país — evita distorção do desvio em unidades multi-país.
  const vendaAAMap = new Map<string, number>();
  for (const v of vendasAA) {
    const futureMonth = new Date(v.month);
    futureMonth.setUTCFullYear(futureMonth.getUTCFullYear() + 1);
    const mk  = futureMonth.toISOString().substring(0, 7);
    const key = `${v.produtoId}_${v.paisIso3 ?? ""}_${mk}`;
    vendaAAMap.set(key, (vendaAAMap.get(key) ?? 0) + v.quantidade);
  }

  const salesByProduct = new Map<string, { month: Date; qty: number }[]>();
  for (const s of rawSalesHistory) {
    const arr = salesByProduct.get(s.produtoId) ?? [];
    arr.push({ month: s.month, qty: s._sum.quantidade ?? 0 });
    salesByProduct.set(s.produtoId, arr);
  }

  // Agrega por produtoId+mês — necessário para EXPORT onde múltiplos países podem
  // aparecer no mesmo mês quando nenhum filtro de país está ativo.
  const orcHistAgg = new Map<string, Map<string, { month: Date; orc: number }>>();
  for (const o of rawOrcHistory) {
    const mk = o.month.toISOString().substring(0, 7);
    if (!orcHistAgg.has(o.produtoId)) orcHistAgg.set(o.produtoId, new Map());
    const byMonth = orcHistAgg.get(o.produtoId)!;
    const existing = byMonth.get(mk);
    if (existing) existing.orc += o.volumeORC;
    else byMonth.set(mk, { month: o.month, orc: o.volumeORC });
  }
  const orcHistoryByProduct = new Map(
    [...orcHistAgg.entries()].map(([pid, byMonth]) => [
      pid,
      [...byMonth.values()].sort((a, b) => a.month.getTime() - b.month.getTime()),
    ])
  );

  // prevFCTS por "produtoId_paisIso3_YYYY-MM"
  const prevFctsMap = new Map<string, number>();
  if (prevRun) {
    const prevItems = await prisma.forecastItem.findMany({
      where:  { runId: prevRun.id, unidadeVendaId, month: { gte: windowGte, lte: windowLte } },
      select: { id: true, produtoId: true, paisIso3: true, month: true },
    });
    const prevItemIds = prevItems.map(pi => pi.id);
    const prevOverrides = prevItemIds.length > 0
      ? await prisma.forecastOverride.findMany({
          where:  { forecastItemId: { in: prevItemIds } },
          select: { forecastItemId: true, volumeFCTS: true },
        })
      : [];
    const prevOverrideMap = new Map(prevOverrides.map(o => [o.forecastItemId, o.volumeFCTS]));
    for (const pi of prevItems) {
      const fcts = prevOverrideMap.get(pi.id);
      if (fcts != null) {
        const mk = pi.month.toISOString().substring(0, 7);
        prevFctsMap.set(`${pi.produtoId}_${pi.paisIso3 ?? ""}_${mk}`, fcts);
      }
    }
    console.log(`[prevFCTS] unidade=${unidadeVendaId} prevRunId=${prevRun.id} items=${prevItems.length} overrides=${prevOverrides.length} mapeados=${prevFctsMap.size}`);
  }

  // Busca overrides dos itens históricos separadamente (evita nested take:1 em ~68k linhas)
  const histItemIds = historicalFctsItems.map(fi => fi.id);
  const histOverrides = histItemIds.length > 0
    ? await prisma.forecastOverride.findMany({
        where:  { forecastItemId: { in: histItemIds } },
        select: { forecastItemId: true, volumeFCTS: true },
      })
    : [];
  const histOverrideMap = new Map(histOverrides.map(o => [o.forecastItemId, o.volumeFCTS]));

  // historicalFCTS — two-pass igual ao consolidado (orcamento.service.ts linhas 293-313):
  // Pass 1: run aprovado mais recente por (produtoId, mês)
  const latestRunPerHistKey = new Map<string, { runId: string; executedAt: Date }>();
  for (const fi of historicalFctsItems) {
    if (histOverrideMap.get(fi.id) == null) continue;
    const mk     = fi.month.toISOString().substring(0, 7);
    const key    = `${fi.produtoId}_${mk}`;
    const execAt = fi.run.executedAt;
    const cur    = latestRunPerHistKey.get(key);
    if (!cur || execAt > cur.executedAt)
      latestRunPerHistKey.set(key, { runId: fi.runId, executedAt: execAt });
  }
  // Pass 2: soma FCTS apenas do run mais recente (multi-país no mesmo run é somado — EXPORT)
  const historicalFctsMap = new Map<string, number>();
  for (const fi of historicalFctsItems) {
    const fcts = histOverrideMap.get(fi.id);
    if (fcts == null) continue;
    const mk  = fi.month.toISOString().substring(0, 7);
    const key = `${fi.produtoId}_${mk}`;
    if (fi.runId !== latestRunPerHistKey.get(key)?.runId) continue;
    historicalFctsMap.set(key, (historicalFctsMap.get(key) ?? 0) + fcts);
  }

  // ── Agrupa itens por produto ───────────────────────────────────────────────
  type MonthEntry = {
    month: string; itemId: string; volumeORC: number; volumeIA: number | null;
    prevFCTS: number | null; vendaAA: number | null;
    override: { id: string; volumeFCTS: number } | null;
    gestorExcluido: boolean; paisIso3: string | null;
  };

  type ProductEntry = {
    produtoId: string; codigo: string; descricao: string;
    classe: string | null; familia: string | null;
    gestorExcluido: boolean; source: string;
    avgTrim: number | null; avgSem: number | null; avg12m: number | null;
    salesHistory: { month: string; qty: number }[];
    orcHistory:   { month: string; volumeORC: number }[];
    fctsHistory:  { month: string; fcts: number }[];
    months: MonthEntry[];
  };

  const productMap = new Map<string, ProductEntry>();

  for (const item of items) {
    const prodKey = item.produtoId;

    if (!productMap.has(prodKey)) {
      const history = salesByProduct.get(prodKey) ?? [];
      const last3   = history.slice(-3);
      const last6   = history.slice(-6);

      // FCTS histórico: último override registrado por mês histórico (soma multi-país)
      const fctsHistory: { month: string; fcts: number }[] = [];
      for (const h of history) {
        const mk  = h.month.toISOString().substring(0, 7);
        const val = historicalFctsMap.get(`${prodKey}_${mk}`);
        if (val != null) fctsHistory.push({ month: mk, fcts: val });
      }

      productMap.set(prodKey, {
        produtoId:      prodKey,
        codigo:         item.produto.codigo,
        descricao:      item.produto.descricao,
        classe:         item.produto.classe ?? null,
        familia:        familiaByProduto.get(prodKey) ?? null,
        gestorExcluido: true,   // sobrescrito abaixo se algum mês estiver ativo
        source:         item.source,
        avgTrim:  last3.length ? Math.round(last3.reduce((s, h) => s + h.qty, 0) / last3.length) : null,
        avgSem:   last6.length ? Math.round(last6.reduce((s, h) => s + h.qty, 0) / last6.length) : null,
        avg12m:   history.length ? Math.round(history.reduce((s, h) => s + h.qty, 0) / history.length) : null,
        salesHistory: history.map(h => ({ month: h.month.toISOString(), qty: h.qty })),
        orcHistory:   (orcHistoryByProduct.get(prodKey) ?? []).map(o => ({
          month: o.month.toISOString(), volumeORC: o.orc,
        })),
        fctsHistory,
        months: [],
      });
    }

    const product = productMap.get(prodKey)!;
    if (!item.gestorExcluido) product.gestorExcluido = false;

    const mk     = item.month.toISOString().substring(0, 7);
    const orcKey = `${prodKey}_${item.paisIso3 ?? ""}_${mk}`;

    product.months.push({
      month:          mk,
      itemId:         item.id,
      volumeORC:      orcMap.get(orcKey) ?? 0,
      volumeIA:       item.volumeIA ?? null,
      prevFCTS:       prevFctsMap.get(orcKey) ?? null,
      vendaAA:        vendaAAMap.get(`${prodKey}_${item.paisIso3 ?? ""}_${mk}`) ?? null,
      override:       overrideMap.get(item.id) ?? null,
      gestorExcluido: item.gestorExcluido,
      paisIso3:       item.paisIso3 ?? null,
    });
  }

  const result = {
    run:      { windowStart: run.windowStart, windowEnd: run.windowEnd, leadTimeMonths: run.leadTimeMonths },
    products: Array.from(productMap.values()),
  };
  appCache.set(cacheKey, result, 2 * 60 * 1000);
  return result;
};
