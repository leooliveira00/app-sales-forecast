/**
 * Portfólio do gestor no ciclo: excluir, restaurar e adicionar manualmente produtos (com auditoria).
 * Extraído de forecast.service.ts — reexportado por ele para manter os imports existentes.
 */
import { Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import { logAudit } from "./audit.service.js";
import { getUserSnapshot, invalidateAnalyticsCache } from "./forecast-shared.service.js";

// ── Gestão de portfólio por ciclo (excluir / restaurar / adicionar manual) ──

/**
 * Marca como excluído os itens de um produto em um run (para uma unidade).
 * Para unidades EXPORT, paisIso3 pode ser omitido (exclui todos os países)
 * ou informado (exclui apenas o país especificado).
 * Soft delete: os dados são preservados para auditoria.
 */
export const excludeProduct = async (
  runId: string,
  produtoId: string,
  unidadeVendaId: string,
  gestorId: string,
  paisIso3?: string | null
) => {
  const userSnap = await getUserSnapshot(gestorId);
  const whereFilter: Prisma.ForecastItemWhereInput = { runId, produtoId, unidadeVendaId };
  if (paisIso3 !== undefined) whereFilter.paisIso3 = paisIso3;

  const items = await prisma.forecastItem.findMany({
    where:  whereFilter,
    select: { id: true, month: true, gestorExcluido: true, run: { select: { refMonth: true } } },
  });

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.forecastItem.updateMany({
      where: whereFilter,
      data:  { gestorExcluido: true, excluidoAt: now, excluidoPorId: gestorId },
    });

    await logAudit(tx, {
      userId:     gestorId,
      userNome:   userSnap.nome,
      userPerfil: userSnap.perfil,
      source:     "user",
      action:     "DELETE",
      entity:     "ForecastItem",
      entityId:   produtoId,
      refMonth:   items[0]?.run.refMonth.toISOString().substring(0, 7) ?? null,
      unidadeId:  unidadeVendaId,
      produtoId,
      paisIso3:   paisIso3 ?? null,
      before:     { gestorExcluido: false },
      after:      { gestorExcluido: true, excluidoAt: now.toISOString() },
      metadata:   { operation: "EXCLUDE_PRODUCT", paisIso3: paisIso3 ?? null, affectedCount: items.length },
    });

    return updated;
  });

  invalidateAnalyticsCache();
  return result;
};

/**
 * Restaura os itens de um produto excluído em um run (para uma unidade).
 * Para unidades EXPORT, paisIso3 pode ser omitido (restaura todos os países)
 * ou informado (restaura apenas o país especificado).
 */
export const restoreProduct = async (
  runId: string,
  produtoId: string,
  unidadeVendaId: string,
  gestorId: string,
  paisIso3?: string | null
) => {
  const userSnap = await getUserSnapshot(gestorId);
  const where: Record<string, unknown> = { runId, produtoId, unidadeVendaId };
  if (paisIso3 !== undefined) where.paisIso3 = paisIso3;

  const beforeItems = await prisma.forecastItem.findMany({
    where: where as { runId: string; produtoId: string; unidadeVendaId: string; paisIso3?: string | null },
    select: { id: true, gestorExcluido: true, excluidoAt: true, excluidoPorId: true },
  });

  const run = await prisma.forecastRun.findUnique({
    where:  { id: runId },
    select: { refMonth: true },
  });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.forecastItem.updateMany({
      where: where as { runId: string; produtoId: string; unidadeVendaId: string; paisIso3?: string | null },
      data: { gestorExcluido: false, excluidoAt: null, excluidoPorId: null },
    });

    await logAudit(tx, {
      userId:     gestorId,
      userNome:   userSnap.nome,
      userPerfil: userSnap.perfil,
      source:     "user",
      action:     "UPDATE",
      entity:     "ForecastItem",
      entityId:   produtoId,
      refMonth:   run?.refMonth.toISOString().substring(0, 7) ?? null,
      unidadeId:  unidadeVendaId,
      produtoId,
      paisIso3:   paisIso3 ?? null,
      before:     { gestorExcluido: true },
      after:      { gestorExcluido: false, excluidoAt: null, excluidoPorId: null },
      metadata:   { operation: "RESTORE_PRODUCT", paisIso3: paisIso3 ?? null, affectedCount: beforeItems.length },
    });

    return updated;
  });

  invalidateAnalyticsCache();
  return result;
};

/**
 * Adiciona um produto manualmente a um run existente.
 * Cria um ForecastItem com source="MANUAL" para cada mês da janela do run.
 * Se o produto já existir no run (mesmo excluído), restaura-o em vez de criar duplicatas.
 */
export const addManualProduct = async (
  runId: string,
  produtoId: string,
  unidadeVendaId: string,
  gestorId: string,
  paisIso3: string | null = null  // null = Nacional; string = Export por país
) => {
  const userSnap = await getUserSnapshot(gestorId);

  // Resolve o refMonth a partir do runId fornecido pelo cliente
  const specifiedRun = await prisma.forecastRun.findUnique({
    where:  { id: runId },
    select: { refMonth: true },
  });
  if (!specifiedRun) throw new Error("Run não encontrado");

  // Sempre usa o run mais recente para o mês — consistente com getForecastItemsAnnual
  const run = await prisma.forecastRun.findFirst({
    where:   { refMonth: specifiedRun.refMonth, status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
    select:  { id: true, windowStart: true, windowEnd: true, leadTimeMonths: true, refMonth: true },
  });
  if (!run) throw new Error("Run não encontrado");

  const refMonthStr = run.refMonth.toISOString().substring(0, 7);

  // Verifica se já existem itens para este produto no run (escopo correto de paisIso3)
  const existing = await prisma.forecastItem.findMany({
    where:  { runId: run.id, produtoId, unidadeVendaId, paisIso3 },
    select: { id: true, gestorExcluido: true, excluidoAt: true, excluidoPorId: true },
  });

  if (existing.length > 0) {
    // Produto já existe (pode estar excluído) — apenas restaura no escopo correto
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.forecastItem.updateMany({
        where: { runId: run.id, produtoId, unidadeVendaId, paisIso3 },
        data: { gestorExcluido: false, excluidoAt: null, excluidoPorId: null, source: "MANUAL" },
      });

      for (const item of existing) {
        await logAudit(tx, {
          userId:     gestorId,
          userNome:   userSnap.nome,
          userPerfil: userSnap.perfil,
          source:     "user",
          action:     "UPDATE",
          entity:     "ForecastItem",
          entityId:   item.id,
          refMonth:   refMonthStr,
          unidadeId:  unidadeVendaId,
          produtoId,
          before:     { gestorExcluido: item.gestorExcluido, excluidoAt: item.excluidoAt, excluidoPorId: item.excluidoPorId },
          after:      { gestorExcluido: false, source: "MANUAL" },
          metadata:   { operation: "ADD_PRODUCT_MANUAL", runId: run.id, paisIso3 },
        });
      }

      return updated;
    });
    invalidateAnalyticsCache();
    return result;
  }

  // Determina a janela a partir do run
  const start = run.windowStart ?? (() => {
    const r = new Date(run.refMonth);
    return new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + run.leadTimeMonths, 1));
  })();

  // Cria 12 itens cobrindo toda a janela
  const itemsToCreate: { runId: string; produtoId: string; unidadeVendaId: string; month: Date; paisIso3: string | null; volumeIA: number; source: "MANUAL" }[] = [];
  for (let i = 0; i < 12; i++) {
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    itemsToCreate.push({
      runId: run.id,
      produtoId,
      unidadeVendaId,
      month,
      paisIso3,
      volumeIA: 0,
      source:   "MANUAL" as const,
    });
  }

  // Para Export (paisIso3 !== null) o upsert funciona normalmente no índice composto.
  // Para Nacional (paisIso3 === null) o Prisma 6 rejeita null no where do upsert,
  // mas como existing.length === 0 podemos usar create diretamente.
  const txResult = await prisma.$transaction(async (tx) => {
    const created = await Promise.all(
      paisIso3 !== null
        ? itemsToCreate.map((item) =>
            tx.forecastItem.upsert({
              where: {
                runId_produtoId_unidadeVendaId_month_paisIso3: {
                  runId:          item.runId,
                  produtoId:      item.produtoId,
                  unidadeVendaId: item.unidadeVendaId,
                  month:          item.month,
                  paisIso3:       item.paisIso3!,
                },
              },
              create: item,
              update: { gestorExcluido: false, excluidoAt: null, excluidoPorId: null, source: "MANUAL" },
            })
          )
        : itemsToCreate.map((item) => tx.forecastItem.create({ data: item }))
    );

    await logAudit(tx, {
      userId:     gestorId,
      userNome:   userSnap.nome,
      userPerfil: userSnap.perfil,
      source:     "user",
      action:     "CREATE",
      entity:     "ForecastItem",
      entityId:   run.id,
      refMonth:   refMonthStr,
      unidadeId:  unidadeVendaId,
      produtoId,
      before:     null,
      after:      { source: "MANUAL", paisIso3, itemCount: created.length },
      metadata:   { operation: "ADD_PRODUCT_MANUAL", runId: run.id, paisIso3 },
    });

    return created;
  });
  invalidateAnalyticsCache();
  return txResult;
};
