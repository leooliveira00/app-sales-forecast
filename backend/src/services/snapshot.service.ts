/**
 * snapshot.service.ts
 *
 * Gerencia as tabelas de snapshot pré-computado:
 *   - ConsolidadoMesSnapshot         (ORC/FCTS/Vendas mensais por unidade)
 *   - ConsolidadoProdutoMesSnapshot   (ORC/FCTS/Vendas mensais por produto×unidade)
 *   - AcuraciaSnapshot                (acurácia/bias por unidade × anchorMonth)
 *
 * Princípio: os snapshots são construídos com as mesmas queries e lógica
 * já existentes, mas persistidos para servir leituras subsequentes em ~5 ms
 * em vez de recalcular em cada request.
 *
 * Os endpoints de leitura fazem: snapshot → fallback para query ao vivo.
 * Os hooks de escrita (controllers/services) disparam refresh fire-and-forget.
 */

import prisma from "../config/prisma.js";
import { getAcuraciaUnidades } from "./forecast.service.js";
import { winningRunByUnitMonth, type ForecastRunMeta } from "../utils/forecast-cycle.js";

/** Snapshots com computedAt mais antigo que este valor são considerados stale. */
export const SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Dedup de refreshes em andamento: chave = "ano" ou "ano:unit1,unit2".
 * Chamadas concorrentes com a mesma chave recebem a Promise já em voo,
 * evitando N execuções idênticas simultâneas que esgotem o pool de conexões.
 */
const consolidadoRefreshInProgress = new Map<string, Promise<void>>();

/**
 * Dedup de refreshes de acurácia em andamento: chave = "anchorMonth:units".
 * Sem isso, cada override/aprovação dispara um refresh fire-and-forget que
 * executa getAcuraciaUnidades 3x (janelas 3/6/12) e satura o pool Prisma.
 */
const acuraciaSnapshotRefreshInProgress = new Map<string, Promise<void>>();

// ── Helpers internos ────────────────────────────────────────────────────────

/**
 * Para os dois runs aprovados mais recentes de um ano, calcula o FCTS total
 * por chave "unidadeVendaId|YYYY-MM". Usado para popular latestRunFcts/prevRunFcts.
 */
async function computeRunFctsByUnitMonth(runId: string): Promise<Map<string, number>> {
  const items = await prisma.forecastItem.findMany({
    where:   { runId, gestorExcluido: false },
    include: { overrides: { take: 1, orderBy: { updatedAt: "desc" } } },
  });
  const map = new Map<string, number>();
  for (const item of items) {
    const mk  = item.month.toISOString().substring(0, 7);
    const key = `${item.unidadeVendaId}|${mk}`;
    map.set(key, (map.get(key) ?? 0) + (item.overrides[0]?.volumeFCTS ?? 0));
  }
  return map;
}

type GrainRow = {
  unidadeVendaId:   string;
  produtoId:        string;
  produtoCodigo:    string;
  produtoDescricao: string;
  familia:          string | null;
  classe:           string | null;
  refMonth:         string; // "YYYY-MM"
  orc:              number;
  fcts:             number;
  vendas:           number;
};

/**
 * Executa as mesmas queries que getConsolidado internamente, mas retorna os
 * dados no nível de granularidade (produto × unidade × mês).
 * Usado exclusivamente por refreshConsolidadoSnapshot.
 */
async function computeGrain(
  orcamentoAno: number,
  opts?: { affectedUnits?: string[] }
): Promise<{
  mesRows:      Map<string, { orc: number; fcts: number; vendas: number; submissaoStatus: string | null; latestRunFcts: number; prevRunFcts: number }>;
  grainRows:    GrainRow[];
}> {
  const anoGte = new Date(`${orcamentoAno}-01-01T00:00:00Z`);
  const anoLt  = new Date(`${orcamentoAno + 1}-01-01T00:00:00Z`);

  const unitFilter = opts?.affectedUnits ? { unidadeVendaId: { in: opts.affectedUnits } } : {};

  // ── Queries em paralelo ────────────────────────────────────────────────────
  const [orcItems, approvedSubs, vendas, submissions, allSuccessRuns] = await Promise.all([
    prisma.orcamentoItem.findMany({
      where: {
        orcamentoAno,
        month: { gte: anoGte, lt: anoLt },
        ...unitFilter,
      },
      include: {
        produto: {
          select: {
            codigo:    true,
            descricao: true,
            classe:    true,
            unidades:  { select: { unidadeVendaId: true, familia: true } },
          },
        },
      },
    }),
    prisma.divisionSubmission.findMany({
      where:  { status: "APPROVED" },
      select: { unidadeVendaId: true, refMonth: true },
    }),
    prisma.vendaMensal.findMany({
      where: {
        month: { gte: anoGte, lt: anoLt },
        ...unitFilter,
      },
      select: { produtoId: true, unidadeVendaId: true, month: true, quantidade: true },
    }),
    prisma.divisionSubmission.findMany({
      where: { refMonth: { gte: anoGte, lt: anoLt }, ...unitFilter },
      select: { unidadeVendaId: true, refMonth: true, status: true },
    }),
    prisma.forecastRun.findMany({
      where:  { status: "SUCCESS" },
      select: { id: true, refMonth: true, executedAt: true, windowStart: true, windowEnd: true },
    }),
  ]);

  // ── Approved run maps (mesma lógica de getConsolidado) ────────────────────
  const approvedRefMonthsSet = new Set(approvedSubs.map(s => s.refMonth.toISOString()));
  const approvedRuns = allSuccessRuns.filter(r => approvedRefMonthsSet.has(r.refMonth.toISOString()));

  const runByRefMonth   = new Map(approvedRuns.map(r => [r.refMonth.toISOString(), r.id]));
  const approvedRunIds  = approvedRuns.map(r => r.id);

  const approvedRunsByUnit = new Map<string, Set<string>>();
  for (const sub of approvedSubs) {
    const runId = runByRefMonth.get(sub.refMonth.toISOString());
    if (!runId) continue;
    if (!approvedRunsByUnit.has(sub.unidadeVendaId))
      approvedRunsByUnit.set(sub.unidadeVendaId, new Set());
    approvedRunsByUnit.get(sub.unidadeVendaId)!.add(runId);
  }

  // ── ForecastItems ao nível produto×unidade×mês ────────────────────────────────
  // Sem filtro de paisIso3: unidades NACIONAL têm paisIso3=null; unidades EXPORT
  // têm um item por país. fctsByKey soma todos os países do mesmo produto×unidade×mês.
  const allForecastItems = approvedRunIds.length > 0
    ? await prisma.forecastItem.findMany({
        where: {
          month:          { gte: anoGte, lt: anoLt },
          runId:          { in: approvedRunIds },
          gestorExcluido: false,
          ...unitFilter,
        },
        include: {
          overrides: { take: 1, orderBy: { updatedAt: "desc" } },
          produto:   { select: { codigo: true, descricao: true, classe: true,
                                 unidades: { select: { unidadeVendaId: true, familia: true } } } },
        },
      })
    : [];

  // Ciclo vencedor por (unidade, mês): último ciclo aprovado cuja janela cobre o mês.
  // Substitui a catraca "último run que tinha o produto" — ver utils/forecast-cycle.ts.
  const runMetaById = new Map<string, ForecastRunMeta>(approvedRuns.map(r => [r.id, r]));
  const winningRun  = winningRunByUnitMonth(approvedRunsByUnit, runMetaById);

  const fctsByKey = new Map<string, number>();
  for (const item of allForecastItems) {
    const mk = item.month.toISOString().substring(0, 7);
    if (item.runId !== winningRun.get(`${item.unidadeVendaId}|${mk}`)) continue;
    const cKey = `${item.produtoId}|${item.unidadeVendaId}|${mk}`;
    fctsByKey.set(cKey, (fctsByKey.get(cKey) ?? 0) + (item.overrides[0]?.volumeFCTS ?? 0));
  }

  // ── Vendas por produto×unidade×mês ────────────────────────────────────────
  // A chave NÃO inclui paisIso3: para unidades EXPORT, múltiplos registros
  // com diferentes países são somados corretamente sob a mesma chave produto×unidade×mês.
  const vendasByKey = new Map<string, number>();
  for (const v of vendas) {
    const key = `${v.produtoId}|${v.unidadeVendaId}|${v.month.toISOString().substring(0, 7)}`;
    vendasByKey.set(key, (vendasByKey.get(key) ?? 0) + v.quantidade);
  }

  // ── Vendas por unidade×mês (independente de OrcamentoItems) ───────────────
  // Acumula TODAS as VendaMensal da unidade no mês — tanto paisIso3=null (NACIONAL)
  // quanto paisIso3!=null (EXPORT) — sem depender de existir um OrcamentoItem
  // correspondente. Isso garante números corretos para unidades EXPORT com ORC esparso.
  const vendasByUnitMonth = new Map<string, number>();
  for (const v of vendas) {
    const mk  = v.month.toISOString().substring(0, 7);
    const key = `${v.unidadeVendaId}|${mk}`;
    vendasByUnitMonth.set(key, (vendasByUnitMonth.get(key) ?? 0) + v.quantidade);
  }

  // ── Δ Ciclo: top-2 runs do ano por executedAt ──────────────────────────────
  const topTwoRuns = approvedRuns
    .filter(r => r.refMonth >= anoGte && r.refMonth < anoLt)
    .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())
    .slice(0, 2);

  const [latestRunMap, prevRunMap] = await Promise.all([
    topTwoRuns[0] ? computeRunFctsByUnitMonth(topTwoRuns[0].id) : Promise.resolve(new Map<string, number>()),
    topTwoRuns[1] ? computeRunFctsByUnitMonth(topTwoRuns[1].id) : Promise.resolve(new Map<string, number>()),
  ]);

  // Interseção das janelas: mantém apenas os "unidade|mês" que AMBOS os ciclos preveem.
  // Ciclos mensais consecutivos têm janelas deslocadas em 1 mês; sem este recorte, o mês
  // de fronteira (coberto por só um ciclo) entrava na soma de um lado e não do outro,
  // gerando um Δ espúrio (~ -1/N do horizonte) mesmo sem qualquer revisão. Zerando os
  // meses fora da interseção, somar as colunas em qualquer janela compara sempre o mesmo
  // conjunto de meses dos dois lados.
  for (const key of [...latestRunMap.keys()]) {
    if (!prevRunMap.has(key)) latestRunMap.delete(key);
  }
  for (const key of [...prevRunMap.keys()]) {
    if (!latestRunMap.has(key)) prevRunMap.delete(key);
  }

  // ── Submission status por unidade+mês (para badge) ─────────────────────────
  const subByUnitMonth = new Map<string, string>();
  for (const s of submissions) {
    const key = `${s.unidadeVendaId}|${s.refMonth.toISOString().substring(0, 7)}`;
    subByUnitMonth.set(key, s.status);
  }

  // ── Agrega em mesRows (unidade × mês) ─────────────────────────────────────
  const mesRows = new Map<string, {
    orc: number; fcts: number; vendas: number;
    submissaoStatus: string | null;
    latestRunFcts: number; prevRunFcts: number;
  }>();

  // Dedup: "produtoId|unidadeVendaId|YYYY-MM" já contabilizado para FCTS.
  // Para unidades EXPORT (ex.: APAC), cada produto×mês tem N linhas de OrcamentoItem
  // (uma por país). Sem dedup, o mesmo FCTS seria somado N vezes.
  const seenFctsKeys = new Set<string>();

  for (const item of orcItems) {
    const mk         = item.month.toISOString().substring(0, 7);
    const unitMesKey = `${item.unidadeVendaId}|${mk}`;
    const fctsKey    = `${item.produtoId}|${item.unidadeVendaId}|${mk}`;

    if (!mesRows.has(unitMesKey)) {
      mesRows.set(unitMesKey, {
        orc:             0,
        fcts:            0,
        vendas:          0,
        submissaoStatus: (subByUnitMonth.get(unitMesKey) ?? null) as string | null,
        latestRunFcts:   latestRunMap.get(unitMesKey) ?? 0,
        prevRunFcts:     prevRunMap.get(unitMesKey)   ?? 0,
      });
    }
    const row = mesRows.get(unitMesKey)!;
    row.orc += item.volumeORC;

    // FCTS: contabiliza apenas uma vez por produto×unidade×mês
    if (!seenFctsKeys.has(fctsKey)) {
      seenFctsKeys.add(fctsKey);
      row.fcts += fctsByKey.get(fctsKey) ?? 0;
    }
  }

  // ── Aplica vendas corretas por unidade×mês (desacoplado de OrcamentoItems) ──
  // VendaMensal pode ter múltiplas linhas por país para unidades EXPORT;
  // vendasByUnitMonth já as soma corretamente, independente do loop de orcItems.
  // FCTS já foi acumulado no loop acima via seenFctsKeys.
  for (const [unitMesKey, row] of mesRows) {
    row.vendas = vendasByUnitMonth.get(unitMesKey) ?? 0;
  }

  // ── Cria entradas para unidades sem OrcamentoItems no ano ──────────────────
  // Unidades adicionadas ao sistema após o fechamento do ciclo de ORC de um ano
  // não possuem OrcamentoItems para aquele ano, portanto nunca entram no loop
  // acima. Mesmo assim podem ter VendaMensal real registrada.
  // Sem essas entradas, janelas cross-year (ex: Abr/2025→Mar/2026) mostram zero
  // para meses do ano sem ORC, gerando divergência com o breakdown por país
  // (que consulta VendaMensal diretamente e retorna os valores corretos).
  for (const [unitMesKey, vendasTotal] of vendasByUnitMonth) {
    if (mesRows.has(unitMesKey)) continue; // já foi processada no loop de orcItems
    mesRows.set(unitMesKey, {
      orc:             0,
      fcts:            0,
      vendas:          vendasTotal,
      submissaoStatus: (subByUnitMonth.get(unitMesKey) ?? null) as string | null,
      latestRunFcts:   latestRunMap.get(unitMesKey) ?? 0,
      prevRunFcts:     prevRunMap.get(unitMesKey)   ?? 0,
    });
  }

  // ── Constrói grainRows (produto × unidade × mês) ──────────────────────────
  const grainMap = new Map<string, GrainRow>();

  for (const item of orcItems) {
    const mk      = item.month.toISOString().substring(0, 7);
    const grainKey = `${item.produtoId}|${item.unidadeVendaId}|${mk}`;

    if (!grainMap.has(grainKey)) {
      const familia = item.produto.unidades.find(u => u.unidadeVendaId === item.unidadeVendaId)?.familia ?? null;
      grainMap.set(grainKey, {
        unidadeVendaId:   item.unidadeVendaId,
        produtoId:        item.produtoId,
        produtoCodigo:    item.produto.codigo,
        produtoDescricao: item.produto.descricao,
        familia,
        classe:           item.produto.classe ?? null,
        refMonth:         mk,
        orc:              0,
        fcts:             fctsByKey.get(grainKey)   ?? 0,
        vendas:           vendasByKey.get(grainKey) ?? 0,
      });
    }
    grainMap.get(grainKey)!.orc += item.volumeORC;
  }

  // Produtos sem OrcamentoItem mas com FCTS — ex: produto novo lançado por estratégia
  // não contemplado no orçamento original. Devem aparecer no FCTS consolidado.
  const produtoMetaByKey = new Map<string, { codigo: string; descricao: string; familia: string | null; classe: string | null }>();
  for (const item of allForecastItems) {
    const mk = `${item.produtoId}|${item.unidadeVendaId}`;
    if (!produtoMetaByKey.has(mk)) {
      const familia = item.produto.unidades.find(u => u.unidadeVendaId === item.unidadeVendaId)?.familia ?? null;
      produtoMetaByKey.set(mk, { codigo: item.produto.codigo, descricao: item.produto.descricao, familia, classe: item.produto.classe ?? null });
    }
  }

  for (const [key, fcts] of fctsByKey) {
    if (seenFctsKeys.has(key) || fcts === 0) continue;
    const [produtoId, unidadeVendaId, mk] = key.split("|");
    const unitMesKey = `${unidadeVendaId}|${mk}`;

    if (!mesRows.has(unitMesKey)) {
      mesRows.set(unitMesKey, {
        orc: 0, fcts: 0, vendas: vendasByUnitMonth.get(unitMesKey) ?? 0,
        submissaoStatus: (subByUnitMonth.get(unitMesKey) ?? null) as string | null,
        latestRunFcts:   latestRunMap.get(unitMesKey) ?? 0,
        prevRunFcts:     prevRunMap.get(unitMesKey)   ?? 0,
      });
    }
    mesRows.get(unitMesKey)!.fcts += fcts;

    const meta = produtoMetaByKey.get(`${produtoId}|${unidadeVendaId}`);
    if (meta && !grainMap.has(key)) {
      grainMap.set(key, {
        unidadeVendaId, produtoId,
        produtoCodigo:    meta.codigo,
        produtoDescricao: meta.descricao,
        familia:          meta.familia,
        classe:           meta.classe,
        refMonth:         mk,
        orc:              0,
        fcts:             fcts,
        vendas:           vendasByKey.get(key) ?? 0,
      });
    } else if (meta && grainMap.has(key)) {
      grainMap.get(key)!.fcts += fcts;
    }
  }

  // Produtos com vendas mas sem OrcamentoItem e sem ForecastItem — ex: produtos
  // vendidos mas não previstos nem orçados. Sem este bloco o breakdown de famílias
  // fica incompleto enquanto o snapshot estiver ativo.
  const coveredGrainKeys = new Set(grainMap.keys());
  const extraVendasByKey = new Map<string, number>(); // "produtoId|unidadeVendaId|mk" → qty
  for (const v of vendas) {
    const mk  = v.month.toISOString().substring(0, 7);
    const key = `${v.produtoId}|${v.unidadeVendaId}|${mk}`;
    if (!coveredGrainKeys.has(key))
      extraVendasByKey.set(key, (extraVendasByKey.get(key) ?? 0) + v.quantidade);
  }

  if (extraVendasByKey.size > 0) {
    const extraProdUnitPairs = [...new Set(
      [...extraVendasByKey.keys()].map(k => { const [p, u] = k.split("|"); return `${p}|${u}`; })
    )];
    const extraProdIds = [...new Set(extraProdUnitPairs.map(k => k.split("|")[0]))];

    const extraProds = await prisma.produto.findMany({
      where:  { codigo: { in: extraProdIds } },
      select: {
        codigo:    true,
        descricao: true,
        classe:    true,
        unidades:  { select: { unidadeVendaId: true, familia: true } },
      },
    });
    const extraProdMeta = new Map(extraProds.map(p => [p.codigo, p]));

    for (const [key, vendaQty] of extraVendasByKey) {
      const [produtoId, unidadeVendaId, mk] = key.split("|");
      const meta = extraProdMeta.get(produtoId);
      if (!meta) continue;
      const familia = meta.unidades.find(u => u.unidadeVendaId === unidadeVendaId)?.familia ?? null;
      grainMap.set(key, {
        unidadeVendaId,
        produtoId,
        produtoCodigo:    meta.codigo,
        produtoDescricao: meta.descricao,
        familia,
        classe:           meta.classe ?? null,
        refMonth:         mk,
        orc:              0,
        fcts:             0,
        vendas:           vendaQty,
      });
    }
  }

  return { mesRows, grainRows: Array.from(grainMap.values()) };
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Recalcula e persiste os snapshots de consolidado para o ano informado.
 *
 * @param orcamentoAno  Ano do OrcamentoRun (ex: 2026)
 * @param opts.affectedUnits  Limita o refresh às unidades informadas (undefined = todas)
 */
export function refreshConsolidadoSnapshot(
  orcamentoAno: number,
  opts?: { affectedUnits?: string[] }
): Promise<void> {
  const dedupKey = opts?.affectedUnits
    ? `${orcamentoAno}:${[...opts.affectedUnits].sort().join(",")}`
    : `${orcamentoAno}`;

  const existing = consolidadoRefreshInProgress.get(dedupKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { mesRows, grainRows } = await computeGrain(orcamentoAno, opts);

      const now = new Date();

      // ── Upserts: ConsolidadoMesSnapshot ────────────────────────────────────
      const mesUpserts = Array.from(mesRows.entries()).map(([key, row]) => {
        const [unidadeVendaId, mk] = key.split("|") as [string, string];
        const refMonth = new Date(`${mk}-01T00:00:00Z`);
        return prisma.consolidadoMesSnapshot.upsert({
          where: {
            orcamentoAno_unidadeVendaId_refMonth: { orcamentoAno, unidadeVendaId, refMonth },
          },
          create: {
            orcamentoAno,
            unidadeVendaId,
            refMonth,
            orc:             row.orc,
            fcts:            row.fcts,
            vendas:          row.vendas,
            submissaoStatus: row.submissaoStatus,
            latestRunFcts:   row.latestRunFcts,
            prevRunFcts:     row.prevRunFcts,
            computedAt:      now,
          },
          update: {
            orc:             row.orc,
            fcts:            row.fcts,
            vendas:          row.vendas,
            submissaoStatus: row.submissaoStatus,
            latestRunFcts:   row.latestRunFcts,
            prevRunFcts:     row.prevRunFcts,
            computedAt:      now,
          },
        });
      });

      // ── Upserts: ConsolidadoProdutoMesSnapshot ──────────────────────────────
      const prodMesUpserts = grainRows.map(row => {
        const refMonth = new Date(`${row.refMonth}-01T00:00:00Z`);
        return prisma.consolidadoProdutoMesSnapshot.upsert({
          where: {
            orcamentoAno_unidadeVendaId_produtoId_refMonth: {
              orcamentoAno,
              unidadeVendaId: row.unidadeVendaId,
              produtoId:      row.produtoId,
              refMonth,
            },
          },
          create: {
            orcamentoAno,
            unidadeVendaId:   row.unidadeVendaId,
            produtoId:        row.produtoId,
            produtoCodigo:    row.produtoCodigo,
            produtoDescricao: row.produtoDescricao,
            familia:          row.familia,
            classe:           row.classe,
            refMonth,
            orc:              row.orc,
            fcts:             row.fcts,
            vendas:           row.vendas,
            computedAt:       now,
          },
          update: {
            produtoCodigo:    row.produtoCodigo,
            produtoDescricao: row.produtoDescricao,
            familia:          row.familia,
            classe:           row.classe,
            orc:              row.orc,
            fcts:             row.fcts,
            vendas:           row.vendas,
            computedAt:       now,
          },
        });
      });

      // ── Executa em lotes de 200 para não sobrecarregar o pool ──────────────
      const allOps = [...mesUpserts, ...prodMesUpserts];
      for (let i = 0; i < allOps.length; i += 200) {
        await prisma.$transaction(allOps.slice(i, i + 200));
      }

      // ── Prune: remove linhas que NÃO foram (re)geradas nesta execução ─────────
      // O upsert acima não apaga linhas órfãs. Ex.: um produto que saiu do ciclo
      // vencedor do mês deixa de ser gerado; sem prune, sua linha antiga permaneceria
      // com o FCTS obsoleto (fantasma). Toda linha gerada agora recebeu computedAt=now;
      // qualquer linha do mesmo escopo (ano + unidades afetadas) com computedAt < now
      // é obsoleta e deve sair.
      const pruneScope = opts?.affectedUnits?.length
        ? { unidadeVendaId: { in: opts.affectedUnits } }
        : {};
      const [prunedMes, prunedProd] = await Promise.all([
        prisma.consolidadoMesSnapshot.deleteMany({
          where: { orcamentoAno, ...pruneScope, computedAt: { lt: now } },
        }),
        prisma.consolidadoProdutoMesSnapshot.deleteMany({
          where: { orcamentoAno, ...pruneScope, computedAt: { lt: now } },
        }),
      ]);
      if (prunedMes.count || prunedProd.count) {
        console.log(`[snapshot] consolidado ${orcamentoAno} prune — ${prunedMes.count} mes, ${prunedProd.count} produto-mes obsoletas removidas`);
      }

      console.log(
        `[snapshot] consolidado ${orcamentoAno} refreshed` +
        ` — ${mesUpserts.length} mes, ${prodMesUpserts.length} produto-mes rows` +
        (opts?.affectedUnits ? ` (units: ${opts.affectedUnits.join(",")})` : "")
      );
    } finally {
      consolidadoRefreshInProgress.delete(dedupKey);
    }
  })();

  consolidadoRefreshInProgress.set(dedupKey, promise);
  return promise;
}

/**
 * Recalcula e persiste o snapshot de acurácia para o anchorMonth informado.
 *
 * @param opts.anchorMonth   "YYYY-MM" opcional. Omitir = último mês com vendas.
 * @param opts.affectedUnits  Limita o upsert às unidades informadas.
 */
export function refreshAcuraciaSnapshot(
  opts?: { anchorMonth?: string; affectedUnits?: string[] }
): Promise<void> {
  const dedupKey = `${opts?.anchorMonth ?? "latest"}:${
    opts?.affectedUnits ? [...opts.affectedUnits].sort().join(",") : "all"
  }`;
  const existing = acuraciaSnapshotRefreshInProgress.get(dedupKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      // Resolve o anchorMonth efetivo (mesma lógica de getAcuraciaUnidades)
      const latestVenda = await prisma.vendaMensal.findFirst({
        orderBy: { month: "desc" },
        select:  { month: true },
      });
      if (!latestVenda) return;

      let ref = opts?.anchorMonth
        ? new Date(`${opts.anchorMonth}-01T00:00:00Z`)
        : latestVenda.month;
      if (ref > latestVenda.month) ref = latestVenda.month;

      const now = new Date();

      // Pré-computa snapshots para todas as janelas padrão
      for (const windowMeses of [3, 6, 12]) {
        const data = await getAcuraciaUnidades(windowMeses, opts?.anchorMonth, true) as Array<{
          codigo: string; descricao: string; acuracia: number; bias: number; ciclosValidos: number; totalVendas: number;
        }>;
        if (data.length === 0) continue;

        const upserts = data
          .filter(u => !opts?.affectedUnits || opts.affectedUnits.includes(u.codigo))
          .map(u => prisma.acuraciaSnapshot.upsert({
            where: {
              unidadeVendaId_anchorMonth_meses: { unidadeVendaId: u.codigo, anchorMonth: ref, meses: windowMeses },
            },
            create: {
              unidadeVendaId: u.codigo,
              anchorMonth:    ref,
              meses:          windowMeses,
              acuracia:       u.acuracia,
              bias:           u.bias,
              ciclosValidos:  u.ciclosValidos,
              totalVendas:    u.totalVendas,
              computedAt:     now,
            },
            update: {
              acuracia:      u.acuracia,
              bias:          u.bias,
              ciclosValidos: u.ciclosValidos,
              totalVendas:   u.totalVendas,
              computedAt:    now,
            },
          }));

        if (upserts.length > 0) await prisma.$transaction(upserts);

        console.log(
          `[snapshot] acuracia ${ref.toISOString().substring(0, 7)} meses=${windowMeses} refreshed` +
          ` — ${upserts.length} rows`
        );
      }
    } finally {
      acuraciaSnapshotRefreshInProgress.delete(dedupKey);
    }
  })();

  acuraciaSnapshotRefreshInProgress.set(dedupKey, promise);
  return promise;
}

/**
 * Recalcula o AcuraciaSnapshot para todos os meses distintos em VendaMensal.
 * Garante cobertura histórica completa — cada endMonth possível no WindowSelector
 * terá snapshot para janelas 3, 6 e 12 meses, eliminando live queries históricas.
 */
export async function backfillAcuraciaSnapshots(): Promise<void> {
  const distinctMonths = await prisma.$queryRaw<{ month: Date }[]>`
    SELECT DISTINCT month FROM "VendaMensal" ORDER BY month ASC
  `;
  console.log(`[snapshot] acuracia backfill — ${distinctMonths.length} anchor months a processar`);
  for (const { month } of distinctMonths) {
    const anchorMonth = month.toISOString().substring(0, 7);
    try {
      await refreshAcuraciaSnapshot({ anchorMonth });
    } catch (err) {
      console.error(`[snapshot] acuracia backfill ${anchorMonth} failed:`, err);
    }
  }
  console.log(`[snapshot] acuracia backfill concluído — ${distinctMonths.length} anchors`);
}

/**
 * Popula todos os snapshots do zero.
 * Executado uma vez no startup quando as tabelas estão vazias.
 * Fire-and-forget em server.ts — não bloqueia o boot do servidor.
 */
export async function initAllSnapshots(): Promise<void> {
  const startedAt = Date.now();

  // ── Consolidado — popula por ano, cobrindo anos sem snapshot ─────────────
  // Checa por OrcamentoRun individualmente: um ano pode estar ausente mesmo
  // que outros anos já tenham snapshot na tabela.
  {
    const orcRuns = await prisma.orcamentoRun.findMany({
      select:  { ano: true },
      orderBy: { ano: "asc" },
    });
    for (const run of orcRuns) {
      const anoGte = new Date(`${run.ano}-01-01T00:00:00Z`);
      const anoLt  = new Date(`${run.ano + 1}-01-01T00:00:00Z`);
      const countForYear = await prisma.consolidadoMesSnapshot.count({
        where: { refMonth: { gte: anoGte, lt: anoLt } },
      });
      if (countForYear === 0) {
        console.log(`[snapshot] consolidado ${run.ano} sem snapshot — populando...`);
        try {
          await refreshConsolidadoSnapshot(run.ano);
        } catch (err) {
          console.error(`[snapshot] consolidado ${run.ano} failed:`, err);
        }
      } else {
        console.log(`[snapshot] consolidado ${run.ano} ok — ${countForYear} rows`);
      }
    }
  }

  // ── Acurácia — verifica cobertura histórica completa ───────────────────
  // Cobertura adequada = o penúltimo mês com vendas tem snapshot 12m.
  // Verificar apenas presença de QUALQUER linha permite falso-positivo.
  {
    const latestVendaForInit = await prisma.vendaMensal.findFirst({
      orderBy: { month: "desc" },
      select:  { month: true },
    });

    const needsFullBackfill = await (async () => {
      if (!latestVendaForInit) return false;
      const prevAnchor = new Date(latestVendaForInit.month);
      prevAnchor.setUTCMonth(prevAnchor.getUTCMonth() - 1);
      const snapAtPrev = await prisma.acuraciaSnapshot.findFirst({
        where: { anchorMonth: prevAnchor, meses: 12 },
      });
      return snapAtPrev === null;
    })();

    if (needsFullBackfill) {
      console.log("[snapshot] acuracia: cobertura histórica incompleta — populando todos os meses...");
      await backfillAcuraciaSnapshots();
    } else {
      const total = await prisma.acuraciaSnapshot.count();
      console.log(`[snapshot] acuracia ok — ${total} rows`);
    }
  }

  console.log(`[snapshot] init complete — ${Math.round((Date.now() - startedAt) / 1000)}s`);
}
