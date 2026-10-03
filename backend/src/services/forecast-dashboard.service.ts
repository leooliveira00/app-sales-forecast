/**
 * Agregações para o Dashboard: tendência ORC × FCTS × Vendas, desvios críticos, resumo por status de submissão e itens pendentes de preenchimento.
 * Extraído de forecast.service.ts — reexportado por ele para manter os imports existentes.
 */
import prisma from "../config/prisma.js";
import { getSuccessRunMap } from "./forecast-shared.service.js";

// ── Tendência (últimos N meses: ORC × FCTS × Vendas por unidade) ──────────
// Funciona tanto para unidades NACIONAIS como EXPORT (agrega ao nível de unidade)

export const getUnitTendencia = async (
  unidadeVendaId: string,
  meses = 12,
  paisIso3Filter?: string | null,
) => {
  // Ancora a janela no último mês com dados reais de vendas da unidade — assim o
  // indicador avança automaticamente quando o Airflow carrega novos dados, sem
  // depender do relógio do servidor.
  const latestVenda = await prisma.vendaMensal.findFirst({
    where:   { unidadeVendaId },
    orderBy: { month: "desc" },
    select:  { month: true },
  });
  if (!latestVenda) return [];

  const ref = latestVenda.month;
  const lt  = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
  const gte = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - (meses - 1), 1));

  const monthKeys: string[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - i, 1));
    monthKeys.push(d.toISOString().substring(0, 7));
  }

  // ── Fast path: snapshot agregado (sem filtro de país) ────────────────────
  // ConsolidadoMesSnapshot já contém ORC/FCTS/Vendas por (unidadeVendaId, refMonth).
  // Cada refMonth pertence a exatamente um orcamentoAno (o seu próprio ano), então
  // não há duplicatas ao consultar sem filtrar por orcamentoAno.
  // Usado pelo Dashboard; quando há filtro de país (MeuForecastPage) usa live queries.
  if (!paisIso3Filter) {
    const snapshots = await prisma.consolidadoMesSnapshot.findMany({
      where:  { unidadeVendaId, refMonth: { gte, lt } },
      select: { refMonth: true, orc: true, fcts: true, vendas: true },
    });

    const snapByMonth = new Map<string, { orc: number; fcts: number; vendas: number }>();
    for (const s of snapshots) {
      const mk = s.refMonth.toISOString().substring(0, 7);
      snapByMonth.set(mk, { orc: s.orc, fcts: s.fcts, vendas: s.vendas });
    }

    return monthKeys.map((mk) => {
      const snap = snapByMonth.get(mk);
      return {
        month:  mk,
        orc:    snap?.orc    ?? 0,
        fcts:   snap?.fcts   ?? 0,
        vendas: snap?.vendas ?? 0,
      };
    });
  }

  // ── Slow path: live queries (filtro de país ativo — MeuForecastPage) ─────
  // Dispara queries independentes em paralelo
  const [unidade, runMap, vendasTendencia] = await Promise.all([
    prisma.unidadeVenda.findUnique({ where: { codigo: unidadeVendaId }, select: { tipo: true } }),
    getSuccessRunMap(),
    prisma.vendaMensal.findMany({
      where: { unidadeVendaId, month: { gte, lt } },
      select: { month: true, quantidade: true },
    }),
  ]);
  const isExport = unidade?.tipo === "EXPORT";

  // 1. ORC: OrcamentoItem por mês (unidade total, paisIso3 = null para nacionais)
  const [orcItems, allItems] = await Promise.all([
    prisma.orcamentoItem.findMany({
      where: {
        unidadeVendaId,
        month: { gte, lt },
        ...(isExport ? {} : { paisIso3: null }),
      },
      select: { month: true, volumeORC: true },
    }),
    (async () => {
      const successRunIds = [...runMap.keys()];
      return prisma.forecastItem.findMany({
        where: {
          unidadeVendaId,
          month:  { gte, lt },
          runId:  { in: successRunIds },
          // NACIONAL: overrides sempre em itens com paisIso3: null
          // EXPORT + país selecionado: filtra o país específico
          // EXPORT + "Todos": sem filtro de paisIso3 (agrega todos os países)
          ...(!isExport
            ? { paisIso3: null }
            : paisIso3Filter
              ? { paisIso3: paisIso3Filter }
              : {}),
        },
        include: { overrides: { take: 1, orderBy: { updatedAt: "desc" } } },
      });
    })(),
  ]);

  const orcByMonth = new Map<string, number>();
  for (const o of orcItems) {
    const mk = o.month.toISOString().substring(0, 7);
    orcByMonth.set(mk, (orcByMonth.get(mk) ?? 0) + o.volumeORC);
  }

  // 2. FCTS por mês alvo — usa o run mais recente que cobre cada mês
  const fctsByMonth = new Map<string, number>();
  {
    const latestRunByMonth = new Map<string, { runId: string; executedAt: Date }>();
    for (const item of allItems) {
      const mk     = item.month.toISOString().substring(0, 7);
      const execAt = runMap.get(item.runId) ?? new Date(0);
      const cur    = latestRunByMonth.get(mk);
      if (!cur || execAt > cur.executedAt)
        latestRunByMonth.set(mk, { runId: item.runId, executedAt: execAt });
    }
    for (const item of allItems) {
      const mk = item.month.toISOString().substring(0, 7);
      if (item.runId !== latestRunByMonth.get(mk)?.runId) continue;
      fctsByMonth.set(mk, (fctsByMonth.get(mk) ?? 0) + (item.overrides[0]?.volumeFCTS ?? 0));
    }
  }

  // 3. Vendas: já buscadas em paralelo acima via vendasTendencia
  const vendasByMonth = new Map<string, number>();
  for (const v of vendasTendencia) {
    const mk = v.month.toISOString().substring(0, 7);
    vendasByMonth.set(mk, (vendasByMonth.get(mk) ?? 0) + v.quantidade);
  }

  // 4. Série temporal
  return monthKeys.map((mk) => {
    return {
      month:  mk,
      orc:    orcByMonth.get(mk)    ?? 0,
      fcts:   fctsByMonth.get(mk)   ?? 0,
      vendas: vendasByMonth.get(mk) ?? 0,
    };
  });
};

// ── Desvios Críticos (SKUs com |FCTS - ORC| / ORC > threshold) ────────────

export const getDesviosCriticos = async (
  unidadeVendaId: string,
  refMonth: string,
  threshold = 20
) => {
  const run = await prisma.forecastRun.findFirst({
    where: { refMonth: new Date(refMonth), status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
    select: { id: true },
  });

  if (!run) return { skusComDesvio: 0, familias: [], threshold, detalhe: [] };

  // Todos os itens da janela do ciclo (todos os meses), com o FCTS salvo (override)
  // e a família do produto. O desvio considera o PERÍODO INTEIRO, não um único mês.
  const items = await prisma.forecastItem.findMany({
    where: { runId: run.id, unidadeVendaId, gestorExcluido: false },
    include: {
      overrides: { take: 1, orderBy: { updatedAt: "desc" } },
      produto: {
        include: {
          unidades: { where: { unidadeVendaId }, take: 1, select: { familia: true } },
        },
      },
    },
  });

  if (items.length === 0) return { skusComDesvio: 0, familias: [], threshold, detalhe: [] };

  // Janela do ano anterior para a Venda A.A. (mesmo intervalo dos meses do ciclo, -1 ano)
  const monthDates = items.map((i) => i.month.getTime());
  const vendaAAGte = new Date(Math.min(...monthDates));
  vendaAAGte.setUTCFullYear(vendaAAGte.getUTCFullYear() - 1);
  const vendaAALte = new Date(Math.max(...monthDates));
  vendaAALte.setUTCFullYear(vendaAALte.getUTCFullYear() - 1);

  const vendasAA = await prisma.vendaMensal.findMany({
    where:  { unidadeVendaId, month: { gte: vendaAAGte, lte: vendaAALte } },
    select: { produtoId: true, month: true, quantidade: true },
  });

  // Venda A.A. somada por produto + mês do forecast (mês da venda + 1 ano).
  // Soma todos os países (em EXPORT) — o card é agregado por produto.
  const vendaAAMap = new Map<string, number>();
  for (const v of vendasAA) {
    const fm = new Date(v.month);
    fm.setUTCFullYear(fm.getUTCFullYear() + 1);
    const mk = fm.toISOString().substring(0, 7);
    const key = `${v.produtoId}_${mk}`;
    vendaAAMap.set(key, (vendaAAMap.get(key) ?? 0) + v.quantidade);
  }

  // FCTS salvo somado por produto + mês (soma países em EXPORT).
  const fctsByProduct = new Map<string, Map<string, number>>();
  const metaByProduct = new Map<string, { codigo: string; descricao: string; familia: string }>();
  for (const item of items) {
    const override = item.overrides[0]?.volumeFCTS;
    if (override == null) continue; // só meses já preenchidos
    const mk = item.month.toISOString().substring(0, 7);
    if (!fctsByProduct.has(item.produtoId)) {
      fctsByProduct.set(item.produtoId, new Map());
      metaByProduct.set(item.produtoId, {
        codigo:    item.produto.codigo,
        descricao: item.produto.descricao,
        familia:   item.produto.unidades[0]?.familia ?? "Sem família",
      });
    }
    const mm = fctsByProduct.get(item.produtoId)!;
    mm.set(mk, (mm.get(mk) ?? 0) + override);
  }

  const familiasComDesvio = new Set<string>();
  let skusComDesvio = 0;

  // detalheMap: familia → lista de SKUs com desvio
  const detalheMap = new Map<string, {
    codigo: string;
    descricao: string;
    volumeFCTS: number;
    volumeVendaAA: number;
    desvio: number;
  }[]>();

  // Desvio simétrico no período: soma FCTS e Venda A.A. apenas dos meses comparáveis
  // (mês com FCTS salvo E venda A.A. > 0). Mesma lógica da tela Meu Forecast.
  for (const [produtoId, monthsMap] of fctsByProduct) {
    let sumFCTS = 0;
    let sumVendaAA = 0;
    for (const [mk, fcts] of monthsMap) {
      const vAA = vendaAAMap.get(`${produtoId}_${mk}`);
      if (vAA == null || vAA <= 0) continue;
      sumFCTS += fcts;
      sumVendaAA += vAA;
    }
    if (sumVendaAA <= 0 || sumFCTS <= 0) continue;

    const desvio = ((sumFCTS - sumVendaAA) / sumVendaAA) * 100;
    if (Math.abs(desvio) > threshold) {
      skusComDesvio++;
      const meta = metaByProduct.get(produtoId)!;
      familiasComDesvio.add(meta.familia);

      if (!detalheMap.has(meta.familia)) detalheMap.set(meta.familia, []);
      detalheMap.get(meta.familia)!.push({
        codigo:        meta.codigo,
        descricao:     meta.descricao,
        volumeFCTS:    sumFCTS,
        volumeVendaAA: sumVendaAA,
        desvio,
      });
    }
  }

  const detalhe = [...detalheMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([familia, skus]) => ({
      familia,
      skus: skus.sort((a, b) => Math.abs(b.desvio) - Math.abs(a.desvio)),
    }));

  return { skusComDesvio, familias: [...familiasComDesvio], threshold, detalhe };
};

// ── Summary helpers ────────────────────────────────────────────────────────

const CONSOLIDADO_SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Conta produtos preenchidos vs total — parte leve da query do Dashboard.
 *
 * Granularidade = PRODUTO (unidade + produto + país), considerando a janela
 * editável inteira [windowStart .. windowEnd]. Um produto conta como
 * "preenchido" se houver override (FCTS) em QUALQUER mês da janela — alinhado
 * com a percepção do gestor na tela de Forecast, que trabalha os 12 meses
 * (e não apenas o 1º mês da janela).
 */
const getItemCounts = async (
  runId: string,
  windowStart: Date,
  windowEnd: Date | null,
  unidadeVendaIds?: string[]
): Promise<{ filledItems: number; totalItems: number }> => {
  const items = await prisma.forecastItem.findMany({
    where: {
      runId,
      gestorExcluido: false,
      month:          windowEnd ? { gte: windowStart, lte: windowEnd } : { gte: windowStart },
      ...(unidadeVendaIds?.length ? { unidadeVendaId: { in: unidadeVendaIds } } : {}),
    },
    select: {
      produtoId:      true,
      unidadeVendaId: true,
      paisIso3:       true,
      overrides:      { select: { id: true } },
    },
  });

  // Agrupa por produto (unidade + produto + país); preenchido = algum mês com override
  const filledByProduct = new Map<string, boolean>();
  for (const i of items) {
    const key = `${i.unidadeVendaId}|${i.produtoId}|${i.paisIso3 ?? ""}`;
    filledByProduct.set(key, (filledByProduct.get(key) ?? false) || i.overrides.length > 0);
  }

  let filledItems = 0;
  for (const filled of filledByProduct.values()) if (filled) filledItems++;
  return { filledItems, totalItems: filledByProduct.size };
};

export const getDashboardSummary = async (
  month: string,
  unidadeVendaIds?: string[]
) => {
  const run = await prisma.forecastRun.findFirst({
    where: { refMonth: new Date(month), status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
  });

  if (!run) return { run: null, totalORC: 0, totalFCTS: 0, totalItems: 0, filledItems: 0 };

  // Determina o primeiro mês da janela para o resumo do dashboard
  const refDate    = new Date(month);
  const lt         = run.leadTimeMonths ?? 2;
  const firstMonth = run.windowStart
    ?? new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth() + lt, 1));

  const unitFilter = unidadeVendaIds?.length ? { unidadeVendaId: { in: unidadeVendaIds } } : {};

  // ── Tenta servir ORC/FCTS do snapshot (evita joins pesados) ────────────────
  const snapRows = await prisma.consolidadoMesSnapshot.findMany({
    where: {
      orcamentoAno: firstMonth.getUTCFullYear(),
      refMonth:     firstMonth,
      ...unitFilter,
    },
    select: { orc: true, fcts: true, computedAt: true },
  });

  const snapFresh =
    snapRows.length > 0 &&
    snapRows.every((r) => Date.now() - r.computedAt.getTime() < CONSOLIDADO_SNAPSHOT_STALE_MS);

  if (snapFresh) {
    const totalORC  = snapRows.reduce((s, r) => s + Number(r.orc),  0);
    const totalFCTS = snapRows.reduce((s, r) => s + Number(r.fcts), 0);

    const [{ filledItems, totalItems }, totalUnidadesAtivas] = await Promise.all([
      getItemCounts(run.id, firstMonth, run.windowEnd, unidadeVendaIds),
      prisma.unidadeVenda.count({ where: { ativo: true } }),
    ]);

    return { run, totalORC, totalFCTS, totalItems, filledItems, totalUnidadesAtivas };
  }

  // ── Fallback: query ao vivo ────────────────────────────────────────────────
  const items = await prisma.forecastItem.findMany({
    where: {
      runId:          run.id,
      month:          firstMonth,
      gestorExcluido: false,
      ...unitFilter,
    },
    include: { overrides: true },
  });

  // ORC vem do OrcamentoItem (fonte canônica), não do ForecastItem
  const produtoIds = [...new Set(items.map((i) => i.produtoId))];
  const orcUnitIds = unidadeVendaIds?.length ? unidadeVendaIds : [...new Set(items.map((i) => i.unidadeVendaId))];

  // Verifica se há unidades EXPORT entre as unidades consultadas para condicionar
  // o filtro de paisIso3 — ORC nacional usa paisIso3: null, EXPORT usa todos os países
  const orcUnidades = await prisma.unidadeVenda.findMany({
    where:  { codigo: { in: orcUnitIds } },
    select: { codigo: true, tipo: true },
  });
  const hasExport = orcUnidades.some((u) => u.tipo === "EXPORT");

  const orcAgg = await prisma.orcamentoItem.aggregate({
    where: {
      unidadeVendaId: { in: orcUnitIds },
      month:          firstMonth,
      produtoId:      { in: produtoIds },
      // Para mix de nacionais + EXPORT: soma tudo; para somente nacionais: filtra paisIso3: null
      ...(hasExport ? {} : { paisIso3: null }),
    },
    _sum: { volumeORC: true },
  });

  const totalORC    = Number(orcAgg._sum.volumeORC ?? 0);
  const totalFCTS   = items.reduce((s, i) => s + (i.overrides[0]?.volumeFCTS ?? 0), 0);

  // Preenchidos vs total contam por produto na janela inteira (mesma regra do snapshot)
  const { filledItems, totalItems } = await getItemCounts(run.id, firstMonth, run.windowEnd, unidadeVendaIds);

  const totalUnidadesAtivas = await prisma.unidadeVenda.count({
    where: { ativo: true },
  });

  return { run, totalORC, totalFCTS, totalItems, filledItems, totalUnidadesAtivas };
};

/**
 * Lista os produtos PENDENTES (sem FCTS em nenhum mês da janela) do ciclo,
 * agrupados por família — detalhamento do card "Produtos Preenchidos".
 * Usa exatamente a mesma regra de getItemCounts: granularidade por produto
 * (unidade + produto + país), janela inteira; pendente = nenhum override.
 */
export const getPendingFilledItems = async (
  month: string,
  unidadeVendaIds?: string[]
): Promise<{
  total: number;
  familias: {
    familia: string;
    produtos: { codigo: string; descricao: string; classe: string | null; paisIso3: string | null; pais: string | null }[];
  }[];
}> => {
  const run = await prisma.forecastRun.findFirst({
    where: { refMonth: new Date(month), status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
  });
  if (!run) return { total: 0, familias: [] };

  const refDate     = new Date(month);
  const lt          = run.leadTimeMonths ?? 2;
  const windowStart = run.windowStart
    ?? new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth() + lt, 1));
  const windowEnd   = run.windowEnd;

  const items = await prisma.forecastItem.findMany({
    where: {
      runId:          run.id,
      gestorExcluido: false,
      month:          windowEnd ? { gte: windowStart, lte: windowEnd } : { gte: windowStart },
      ...(unidadeVendaIds?.length ? { unidadeVendaId: { in: unidadeVendaIds } } : {}),
    },
    select: {
      produtoId:      true,
      unidadeVendaId: true,
      paisIso3:       true,
      overrides:      { select: { id: true } },
      produto:        { select: { codigo: true, descricao: true, classe: true } },
    },
  });

  // Agrupa por produto (unidade + produto + país); preenchido = algum mês com override.
  // Para unidades EXPORT a granularidade é produto+país (paisIso3 != null), portanto
  // o mesmo produto pode aparecer como pendente em mais de um país.
  type Acc = {
    filled: boolean; produtoId: string; unidadeVendaId: string;
    codigo: string; descricao: string; classe: string | null; paisIso3: string | null;
  };
  const byProduct = new Map<string, Acc>();
  for (const i of items) {
    const key    = `${i.unidadeVendaId}|${i.produtoId}|${i.paisIso3 ?? ""}`;
    const filled = i.overrides.length > 0;
    const prev   = byProduct.get(key);
    if (!prev) {
      byProduct.set(key, {
        filled,
        produtoId:      i.produtoId,
        unidadeVendaId: i.unidadeVendaId,
        codigo:         i.produto.codigo,
        descricao:      i.produto.descricao,
        classe:         i.produto.classe,
        paisIso3:       i.paisIso3,
      });
    } else if (filled) {
      prev.filled = true;
    }
  }

  const pendentes = [...byProduct.values()].filter((p) => !p.filled);
  if (pendentes.length === 0) return { total: 0, familias: [] };

  // Família vem de ProdutoUnidadeVenda (por unidade)
  const famLinks = await prisma.produtoUnidadeVenda.findMany({
    where:  { OR: pendentes.map((p) => ({ unidadeVendaId: p.unidadeVendaId, produtoId: p.produtoId })) },
    select: { unidadeVendaId: true, produtoId: true, familia: true },
  });
  const famByKey = new Map(famLinks.map((l) => [`${l.unidadeVendaId}|${l.produtoId}`, l.familia ?? null]));

  // Nome dos países (EXPORT) para exibir junto do produto pendente
  const paisIso3s = [...new Set(pendentes.map((p) => p.paisIso3).filter((x): x is string => !!x))];
  const paisNomes = paisIso3s.length > 0
    ? await prisma.pais.findMany({ where: { iso3: { in: paisIso3s } }, select: { iso3: true, nome: true } })
    : [];
  const paisByIso = new Map(paisNomes.map((p) => [p.iso3, p.nome]));

  type PendenteProduto = { codigo: string; descricao: string; classe: string | null; paisIso3: string | null; pais: string | null };
  const famMap = new Map<string, PendenteProduto[]>();
  for (const p of pendentes) {
    const fam = famByKey.get(`${p.unidadeVendaId}|${p.produtoId}`)?.trim() || "Outros";
    if (!famMap.has(fam)) famMap.set(fam, []);
    famMap.get(fam)!.push({
      codigo:    p.codigo,
      descricao: p.descricao,
      classe:    p.classe,
      paisIso3:  p.paisIso3,
      pais:      p.paisIso3 ? (paisByIso.get(p.paisIso3) ?? p.paisIso3) : null,
    });
  }

  const familias = [...famMap.entries()]
    .map(([familia, produtos]) => ({
      familia,
      produtos: produtos.sort((a, b) => a.codigo.localeCompare(b.codigo)),
    }))
    .sort((a, b) => a.familia.localeCompare(b.familia));

  return { total: pendentes.length, familias };
};
