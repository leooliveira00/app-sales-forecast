import prisma from "../config/prisma.js";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface VendaAgregadaItem {
  produtoId:      string;
  unidadeVendaId: string;
  month:          string;     // "YYYY-MM-DD" — 1º dia do mês
  canal:          string;     // "VENDA DIRETA" | "DISTRIBUIDOR"
  paisIso3:       string | null;
  quantidade:     number;
  receita:        number;
  // Classificação do produto — vindos do endpoint listavendas
  codigoFamilia?: string | null;
  familia?:       string | null;
  divisao?:       string | null;
}

export interface SyncVendasResult {
  logId:                string;
  totalRecebidos:       number;
  totalAgrupados:       number;
  totalUpsertedVendas:  number;
  totalUpsertedVinculos: number;
  totalSkipped:         number;
  durationMs:           number;
}

// ── Serviço ───────────────────────────────────────────────────────────────────

export const syncVendas = async (
  itens:       VendaAgregadaItem[],
  refMonth:    string,
  cDataDe:     string,
  cDataAte:    string,
  triggeredBy: string
): Promise<SyncVendasResult> => {
  const startedAt = Date.now();

  const log = await prisma.vendasSyncLog.create({
    data: {
      triggeredBy,
      status:         "RUNNING",
      refMonth:       new Date(refMonth),
      cDataDe,
      cDataAte,
      totalRecebidos: itens.length,
    },
  });

  try {
    // Carrega FKs válidas de uma vez para evitar N+1 queries
    const [produtosDb, unidadesDb, paisesDb] = await Promise.all([
      prisma.produto.findMany({ select: { codigo: true } }),
      prisma.unidadeVenda.findMany({ select: { codigo: true } }),
      prisma.pais.findMany({ select: { iso3: true } }),
    ]);

    const produtosValidos = new Set(produtosDb.map((p) => p.codigo));
    const unidadesValidas = new Set(unidadesDb.map((u) => u.codigo));
    const paisesValidos   = new Set(paisesDb.map((p) => p.iso3));

    let totalUpsertedVendas   = 0;
    let totalUpsertedVinculos = 0;
    let totalSkipped          = 0;

    // Rastreia pares já processados neste batch para evitar upserts duplicados em ProdutoUnidadeVenda
    const vinculosProcessados = new Set<string>();

    for (const item of itens) {
      if (!produtosValidos.has(item.produtoId)) {
        console.warn(`[vendas-sync] Skip: produtoId "${item.produtoId}" não encontrado em Produto`);
        totalSkipped++;
        continue;
      }

      if (!unidadesValidas.has(item.unidadeVendaId)) {
        console.warn(`[vendas-sync] Skip: unidadeVendaId "${item.unidadeVendaId}" não encontrada em UnidadeVenda`);
        totalSkipped++;
        continue;
      }

      if (item.paisIso3 && !paisesValidos.has(item.paisIso3)) {
        console.warn(`[vendas-sync] Skip: paisIso3 "${item.paisIso3}" não encontrado em Pais — cadastre o país via seed-pais-csv.ts`);
        totalSkipped++;
        continue;
      }

      const month   = new Date(item.month);
      const paisIso3 = item.paisIso3 ?? null;

      // Busca registro existente incluindo paisIso3 na chave para suportar
      // múltiplos países por (produto, unidade, mês, canal) em unidades EXPORT
      const existingVenda = await prisma.vendaMensal.findFirst({
        where: {
          produtoId:      item.produtoId,
          unidadeVendaId: item.unidadeVendaId,
          month,
          canal:          item.canal,
          paisIso3,
        },
        select: { id: true },
      });

      if (existingVenda) {
        await prisma.vendaMensal.update({
          where: { id: existingVenda.id },
          data:  { quantidade: item.quantidade, receita: item.receita },
        });
      } else {
        await prisma.vendaMensal.create({
          data: {
            produtoId:      item.produtoId,
            unidadeVendaId: item.unidadeVendaId,
            month,
            canal:          item.canal,
            paisIso3,
            quantidade:     item.quantidade,
            receita:        item.receita,
          },
        });
      }

      totalUpsertedVendas++;

      // Upsert ProdutoUnidadeVenda — apenas uma vez por par neste batch
      const vincKey = `${item.produtoId}::${item.unidadeVendaId}`;
      if (!vinculosProcessados.has(vincKey)) {
        await prisma.produtoUnidadeVenda.upsert({
          where:  { produtoId_unidadeVendaId: { produtoId: item.produtoId, unidadeVendaId: item.unidadeVendaId } },
          // Cria o vínculo (produto vendido numa unidade ainda não cadastrada) com a
          // classificação que o movimento trouxe.
          create: {
            produtoId:      item.produtoId,
            unidadeVendaId: item.unidadeVendaId,
            ativo:          true,
            codigoFamilia:  item.codigoFamilia ?? null,
            familia:        item.familia       ?? null,
            divisao:        item.divisao       ?? null,
          },
          // Vínculo já existe: NÃO reescreve nada. A classificação (codigoFamilia/familia/
          // divisao) é de responsabilidade exclusiva do produtos_sync (cadastro mestre).
          // Sobrescrever aqui com o valor por-classe do movimento corromperia a família
          // (ex.: 0365 → 0315 conforme a classe da venda).
          update: {},
        });
        vinculosProcessados.add(vincKey);
        totalUpsertedVinculos++;
      }
    }

    const durationMs = Date.now() - startedAt;

    await prisma.vendasSyncLog.update({
      where: { id: log.id },
      data: {
        status:                "SUCCESS",
        totalAgrupados:        itens.length,
        totalUpsertedVendas,
        totalUpsertedVinculos,
        totalSkipped,
        durationMs,
        finishedAt:            new Date(),
      },
    });

    // Cache invalidation + snapshot refresh são disparados uma única vez no callback
    // final da DAG (airflow-callback.controller.ts), evitando trabalho redundante por lote.

    return {
      logId:                 log.id,
      totalRecebidos:        itens.length,
      totalAgrupados:        itens.length,
      totalUpsertedVendas,
      totalUpsertedVinculos,
      totalSkipped,
      durationMs,
    };
  } catch (err) {
    const durationMs   = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);

    await prisma.vendasSyncLog.update({
      where: { id: log.id },
      data: { status: "FAILED", errorMessage, durationMs, finishedAt: new Date() },
    });

    throw err;
  }
};

// ── Consulta de logs ──────────────────────────────────────────────────────────

export const getLogs = async (page = 1, pageSize = 20) => {
  const skip = (page - 1) * pageSize;
  const [total, items] = await Promise.all([
    prisma.vendasSyncLog.count(),
    prisma.vendasSyncLog.findMany({
      orderBy: { startedAt: "desc" },
      skip,
      take: pageSize,
    }),
  ]);
  return { total, page, pageSize, items };
};

export const getLogById = async (id: string) => {
  return prisma.vendasSyncLog.findUnique({ where: { id } });
};
