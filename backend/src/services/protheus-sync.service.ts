import prisma from "../config/prisma.js";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ProtheusProductItem {
  produto:               string;
  tipo:                  string;
  descricao:             string;
  classe:                string;
  codigoFamiliaAGM?:     string;
  descricaoFamiliaAGM?:  string;
  codigoClasseValor?:    string;
  descricaoClasseValor?: string;
}

export interface UpsertProdutosResult {
  logId:           string;
  totalRecebidos:  number;
  totalUnicos:     number;
  produtosCreated: number;
  produtosUpdated: number;
  puvCreated:      number;
  puvUpdated:      number;
  puvSkipped:      number;
  durationMs:      number;
}

// ── Serviço ───────────────────────────────────────────────────────────────────

export const upsertProdutos = async (
  itens: ProtheusProductItem[],
  triggeredBy: string,
  cTipo = "PA"
): Promise<UpsertProdutosResult> => {
  const startedAt = Date.now();

  const log = await prisma.protheusSyncLog.create({
    data: {
      triggeredBy,
      status:         "RUNNING",
      cTipo,
      totalRecebidos: itens.length,
    },
  });

  try {
    // Deduplica por codigo — o Protheus pode enviar o mesmo produto
    // múltiplas vezes (ex: uma linha por filial). Última ocorrência vence.
    const uniqueMap = new Map<string, ProtheusProductItem>();
    for (const item of itens) {
      uniqueMap.set(item.produto.trim().toUpperCase(), item);
    }
    const uniqueItens = Array.from(uniqueMap.values());
    const codigos = uniqueItens.map((i) => i.produto.trim().toUpperCase());

    // Identificar quais já existem para contar criados vs atualizados
    const existentes = await prisma.produto.findMany({
      where:  { codigo: { in: codigos } },
      select: { codigo: true },
    });
    const codigosExistentes = new Set(existentes.map((p) => p.codigo));

    const created = codigos.filter((c) => !codigosExistentes.has(c)).length;
    const updated = codigos.filter((c) =>  codigosExistentes.has(c)).length;

    const syncedAt = new Date();

    // Upsert em lote — opera apenas sobre registros únicos
    await prisma.$transaction(
      uniqueItens.map((item) => {
        const codigo = item.produto.trim().toUpperCase();
        return prisma.produto.upsert({
          where: { codigo },
          create: {
            codigo,
            descricao:    item.descricao.trim(),
            tipo:         item.tipo?.trim()   || null,
            classe:       item.classe?.trim() || null,
            ativo:        true,
            erpUpdatedAt: syncedAt,
            syncedAt,
          },
          update: {
            descricao:    item.descricao.trim(),
            tipo:         item.tipo?.trim()   || null,
            classe:       item.classe?.trim() || null,
            erpUpdatedAt: syncedAt,
            syncedAt,
          },
        });
      })
    );

    // ── Upsert ProdutoUnidadeVenda ────────────────────────────────────────────

    // Apenas itens que trazem codigoClasseValor (unidade) e codigoFamiliaAGM
    const itensComUnidade = uniqueItens.filter(
      (i) => i.codigoClasseValor?.trim()
    );

    // Guard de FK: verifica quais UnidadeVenda realmente existem no banco
    const codigosUnidade = [...new Set(
      itensComUnidade.map((i) => i.codigoClasseValor!.trim())
    )];
    const unidadesExistentes = await prisma.unidadeVenda.findMany({
      where:  { codigo: { in: codigosUnidade } },
      select: { codigo: true },
    });
    const unidadesSet = new Set(unidadesExistentes.map((u) => u.codigo));

    const itensValidos  = itensComUnidade.filter((i) => unidadesSet.has(i.codigoClasseValor!.trim()));
    const puvSkipped    = itensComUnidade.length - itensValidos.length;

    // Identificar PUV existentes para contar criados vs atualizados
    const puvExistentes = await prisma.produtoUnidadeVenda.findMany({
      where: {
        OR: itensValidos.map((i) => ({
          produtoId:      i.produto.trim().toUpperCase(),
          unidadeVendaId: i.codigoClasseValor!.trim(),
        })),
      },
      select: { produtoId: true, unidadeVendaId: true },
    });
    const puvExistentesSet = new Set(
      puvExistentes.map((p) => `${p.produtoId}|${p.unidadeVendaId}`)
    );

    const puvCreated = itensValidos.filter(
      (i) => !puvExistentesSet.has(`${i.produto.trim().toUpperCase()}|${i.codigoClasseValor!.trim()}`)
    ).length;
    const puvUpdated = itensValidos.length - puvCreated;

    await prisma.$transaction(
      itensValidos.map((item) => {
        const produtoId      = item.produto.trim().toUpperCase();
        const unidadeVendaId = item.codigoClasseValor!.trim();
        return prisma.produtoUnidadeVenda.upsert({
          where:  { produtoId_unidadeVendaId: { produtoId, unidadeVendaId } },
          create: {
            produtoId,
            unidadeVendaId,
            codigoFamilia: item.codigoFamiliaAGM?.trim()    || null,
            familia:       item.descricaoFamiliaAGM?.trim() || null,
            divisao:       item.descricaoClasseValor?.trim() || null,
            ativo:         true,
          },
          update: {
            codigoFamilia: item.codigoFamiliaAGM?.trim()    || null,
            familia:       item.descricaoFamiliaAGM?.trim() || null,
            divisao:       item.descricaoClasseValor?.trim() || null,
          },
        });
      })
    );

    // Propaga codigoFamilia/familia para todos os demais vínculos do produto.
    // O Protheus retorna um único codigoClasseValor por produto, mas a plataforma
    // pode ter o mesmo produto vinculado a várias unidades — sem essa propagação
    // os demais PUVs ficam com família desatualizada.
    const familiaMap = new Map<string, { codigoFamilia: string | null; familia: string | null }>();
    for (const item of itensValidos) {
      const produtoId     = item.produto.trim().toUpperCase();
      const codigoFamilia = item.codigoFamiliaAGM?.trim()    || null;
      const familia       = item.descricaoFamiliaAGM?.trim() || null;
      if (codigoFamilia && !familiaMap.has(produtoId)) {
        familiaMap.set(produtoId, { codigoFamilia, familia });
      }
    }

    if (familiaMap.size > 0) {
      await prisma.$transaction(
        [...familiaMap.entries()].map(([produtoId, data]) =>
          prisma.produtoUnidadeVenda.updateMany({
            where: { produtoId },
            data:  { codigoFamilia: data.codigoFamilia, familia: data.familia },
          })
        )
      );
    }

    // ─────────────────────────────────────────────────────────────────────────

    const durationMs = Date.now() - startedAt;

    await prisma.protheusSyncLog.update({
      where: { id: log.id },
      data: {
        status:          "SUCCESS",
        produtosCreated: created,
        produtosUpdated: updated,
        durationMs,
        finishedAt:      new Date(),
      },
    });

    return {
      logId:           log.id,
      totalRecebidos:  itens.length,
      totalUnicos:     uniqueItens.length,
      produtosCreated: created,
      produtosUpdated: updated,
      puvCreated,
      puvUpdated,
      puvSkipped,
      durationMs,
    };
  } catch (err) {
    const durationMs    = Date.now() - startedAt;
    const errorMessage  = err instanceof Error ? err.message : String(err);

    await prisma.protheusSyncLog.update({
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
    prisma.protheusSyncLog.count(),
    prisma.protheusSyncLog.findMany({
      orderBy: { startedAt: "desc" },
      skip,
      take: pageSize,
    }),
  ]);
  return { total, page, pageSize, items };
};

export const getLogById = async (id: string) => {
  return prisma.protheusSyncLog.findUnique({ where: { id } });
};
