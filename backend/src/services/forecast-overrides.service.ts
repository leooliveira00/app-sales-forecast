/**
 * Overrides de FCTS do gestor: upsert individual e em lote, e exclusão — com histórico (ForecastOverrideHistory) e auditoria.
 * Extraído de forecast.service.ts — reexportado por ele para manter os imports existentes.
 */
import { Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import { logAudit } from "./audit.service.js";
import { AuditContext } from "../types/audit.js";
import { getUserSnapshot, invalidateAnalyticsCache } from "./forecast-shared.service.js";

// ── ForecastOverride ───────────────────────────────────────────────────────

export const upsertOverride = async (
  forecastItemId: string,
  gestorId: string,
  volumeFCTS: number,
  note?: string,
  auditContext?: AuditContext
) => {
  const [existing, item, userSnap] = await Promise.all([
    prisma.forecastOverride.findUnique({ where: { forecastItemId } }),
    prisma.forecastItem.findUnique({
      where:  { id: forecastItemId },
      select: {
        produtoId:      true,
        unidadeVendaId: true,
        paisIso3:       true,
        run:            { select: { refMonth: true } },
      },
    }),
    getUserSnapshot(gestorId),
  ]);

  const override = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.forecastOverrideHistory.create({
        data: {
          forecastItemId: existing.forecastItemId,
          gestorId:       existing.gestorId,
          volumeFCTS:     existing.volumeFCTS,
          note:           existing.note,
          action:         "UPDATE",
        },
      });
    }

    const result = await tx.forecastOverride.upsert({
      where:  { forecastItemId },
      create: { forecastItemId, gestorId, volumeFCTS, note },
      update: { gestorId, volumeFCTS, note },
    });

    if (item && !auditContext?.skipAudit) {
      await logAudit(tx, {
        userId:     gestorId,
        userNome:   userSnap.nome,
        userPerfil: userSnap.perfil,
        source:     "user",
        action:     existing ? "UPDATE" : "CREATE",
        entity:     "ForecastOverride",
        entityId:   forecastItemId,
        refMonth:   item.run.refMonth.toISOString().substring(0, 7),
        unidadeId:  item.unidadeVendaId,
        produtoId:  item.produtoId,
        paisIso3:   item.paisIso3,
        before:     existing ? { volumeFCTS: existing.volumeFCTS, note: existing.note } : null,
        after:      { volumeFCTS, note: note ?? null },
        metadata:   { operation: "MANUAL_EDIT", ...(auditContext ?? {}) },
      });
    }

    return result;
  });

  invalidateAnalyticsCache();
  return override;
};

export const upsertOverrideBulk = async (
  items: Array<{ forecastItemId: string; volumeFCTS: number; note?: string }>,
  gestorId: string,
  auditContext?: AuditContext
) => {
  const ids = items.map((i) => i.forecastItemId);

  const [existingOverrides, forecastItems, userSnap] = await Promise.all([
    prisma.forecastOverride.findMany({ where: { forecastItemId: { in: ids } } }),
    prisma.forecastItem.findMany({
      where:  { id: { in: ids } },
      select: {
        id:             true,
        produtoId:      true,
        unidadeVendaId: true,
        paisIso3:       true,
        run:            { select: { refMonth: true } },
      },
    }),
    getUserSnapshot(gestorId),
  ]);

  const existingMap = new Map(existingOverrides.map((o) => [o.forecastItemId, o]));
  const itemMap     = new Map(forecastItems.map((i) => [i.id, i]));
  const toCreate = items.filter((i) => !existingMap.has(i.forecastItemId));
  const toUpdate = items.filter((i) =>  existingMap.has(i.forecastItemId));

  await prisma.$transaction(async (tx) => {
    // Histórico em lote para overrides existentes
    if (existingOverrides.length > 0) {
      await tx.forecastOverrideHistory.createMany({
        data: existingOverrides.map((existing) => ({
          forecastItemId: existing.forecastItemId,
          gestorId:       existing.gestorId,
          volumeFCTS:     existing.volumeFCTS,
          note:           existing.note,
          action:         "UPDATE",
        })),
      });
    }

    // Cria novos overrides em lote (único INSERT)
    if (toCreate.length > 0) {
      await tx.forecastOverride.createMany({
        data: toCreate.map((i) => ({
          forecastItemId: i.forecastItemId,
          gestorId,
          volumeFCTS:     i.volumeFCTS,
          note:           i.note,
        })),
      });
    }

    // Atualiza overrides existentes individualmente (geralmente poucos)
    for (const item of toUpdate) {
      await tx.forecastOverride.update({
        where: { forecastItemId: item.forecastItemId },
        data:  { gestorId, volumeFCTS: item.volumeFCTS, note: item.note },
      });
    }

    // AuditLog em lote: registra MANUAL_EDIT para cada item alterado
    if (!auditContext?.skipAudit) {
      const auditRows = items.flatMap((i) => {
        const fi = itemMap.get(i.forecastItemId);
        if (!fi) return [];
        const existing = existingMap.get(i.forecastItemId);
        return [{
          userId:     gestorId,
          userNome:   userSnap.nome,
          userPerfil: userSnap.perfil,
          source:     "user" as const,
          action:     (existing ? "UPDATE" : "CREATE") as "UPDATE" | "CREATE",
          entity:     "ForecastOverride",
          entityId:   i.forecastItemId,
          refMonth:   fi.run.refMonth.toISOString().substring(0, 7),
          unidadeId:  fi.unidadeVendaId,
          produtoId:  fi.produtoId,
          paisIso3:   fi.paisIso3,
          before:     existing ? { volumeFCTS: existing.volumeFCTS, note: existing.note } as Prisma.InputJsonValue : Prisma.DbNull,
          after:      { volumeFCTS: i.volumeFCTS, note: i.note ?? null } as Prisma.InputJsonValue,
          metadata:   { operation: "MANUAL_EDIT", ...(auditContext ?? {}) } as Prisma.InputJsonValue,
        }];
      });
      if (auditRows.length > 0) {
        await tx.auditLog.createMany({ data: auditRows });
      }
    }
  }, { timeout: 30_000 });

  invalidateAnalyticsCache();
  return { count: items.length };
};

export const deleteOverride = async (forecastItemId: string, gestorId: string) => {
  const existing = await prisma.forecastOverride.findUnique({ where: { forecastItemId } });

  if (!existing) {
    return prisma.forecastOverride.deleteMany({ where: { forecastItemId } });
  }

  const [item, userSnap] = await Promise.all([
    prisma.forecastItem.findUnique({
      where:  { id: forecastItemId },
      select: {
        produtoId:      true,
        unidadeVendaId: true,
        paisIso3:       true,
        run:            { select: { refMonth: true } },
      },
    }),
    getUserSnapshot(gestorId),
  ]);

  await prisma.$transaction(async (tx) => {
    await tx.forecastOverrideHistory.create({
      data: {
        forecastItemId: existing.forecastItemId,
        gestorId:       existing.gestorId,
        volumeFCTS:     existing.volumeFCTS,
        note:           existing.note,
        action:         "DELETE",
      },
    });

    await tx.forecastOverride.deleteMany({ where: { forecastItemId } });

    if (item) {
      await logAudit(tx, {
        userId:     gestorId,
        userNome:   userSnap.nome,
        userPerfil: userSnap.perfil,
        source:     "user",
        action:     "DELETE",
        entity:     "ForecastOverride",
        entityId:   forecastItemId,
        refMonth:   item.run.refMonth.toISOString().substring(0, 7),
        unidadeId:  item.unidadeVendaId,
        produtoId:  item.produtoId,
        paisIso3:   item.paisIso3,
        before:     { volumeFCTS: existing.volumeFCTS, note: existing.note },
        after:      null,
        metadata:   { operation: "DELETE_OVERRIDE" },
      });
    }
  });

  invalidateAnalyticsCache();
};
