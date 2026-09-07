import { Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import { AuditEntry } from "../types/audit.js";

export function logAudit(tx: Prisma.TransactionClient, entry: AuditEntry) {
  return tx.auditLog.create({
    data: {
      userId:     entry.userId,
      userNome:   entry.userNome,
      userPerfil: entry.userPerfil,
      source:     entry.source,
      action:     entry.action,
      entity:     entry.entity,
      entityId:   entry.entityId,
      refMonth:   entry.refMonth,
      unidadeId:  entry.unidadeId,
      produtoId:  entry.produtoId,
      paisIso3:   entry.paisIso3 ?? null,
      before:   entry.before   != null ? (entry.before   as Prisma.InputJsonValue) : Prisma.DbNull,
      after:    entry.after    != null ? (entry.after    as Prisma.InputJsonValue) : Prisma.DbNull,
      metadata: entry.metadata != null ? (entry.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });
}

export async function queryAuditLogs(
  filters: {
    refMonth?: string;
    unidadeId?: string;
    produtoId?: string;
    userId?: string;
    entity?: string;
    operation?: string;
    paisIso3?: string;
  },
  page: number,
  limit: number
) {
  const cappedLimit = Math.min(limit, 200);
  const skip = (page - 1) * cappedLimit;

  const where: Prisma.AuditLogWhereInput = {};
  if (filters.refMonth)  where.refMonth  = filters.refMonth;
  if (filters.unidadeId) where.unidadeId = filters.unidadeId;
  if (filters.produtoId) where.produtoId = filters.produtoId;
  if (filters.userId)    where.userId    = filters.userId;
  if (filters.entity)    where.entity    = filters.entity;
  if (filters.paisIso3)  where.paisIso3  = filters.paisIso3;
  if (filters.operation) {
    where.metadata = { path: ["operation"], equals: filters.operation };
  }

  const [total, logs] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: cappedLimit,
    }),
  ]);

  const uniqueProdutoIds = [...new Set(logs.map((l) => l.produtoId).filter((id): id is string => id != null))];
  const produtos = uniqueProdutoIds.length > 0
    ? await prisma.produto.findMany({
        where: { codigo: { in: uniqueProdutoIds } },
        select: { codigo: true, descricao: true, unidades: { select: { familia: true }, take: 1 } },
      })
    : [];
  const produtoMap = Object.fromEntries(produtos.map((p) => [p.codigo, {
    codigo: p.codigo,
    descricao: p.descricao,
    familia: p.unidades[0]?.familia ?? null,
  }]));

  const familiaMap: Record<string, string | null> = {};

  const uniqueUserIds = [...new Set(logs.map((l) => l.userId).filter((id): id is string => id != null))];
  const users = uniqueUserIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: uniqueUserIds } },
        select: { id: true, nome: true },
      })
    : [];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.nome]));

  return { total, page, limit: cappedLimit, logs, produtoMap, familiaMap, userMap };
}

export async function getItemHistory(forecastItemId: string) {
  const [overrideHistory, auditLogs] = await Promise.all([
    prisma.forecastOverrideHistory.findMany({
      where: { forecastItemId },
      orderBy: { revisedAt: "desc" },
      include: { gestor: { select: { id: true, nome: true, perfil: true } } },
    }),
    prisma.auditLog.findMany({
      where: { entity: "ForecastOverride", entityId: forecastItemId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const normalized = [
    ...overrideHistory.map((h) => ({
      type: "history" as const,
      timestamp: h.revisedAt.toISOString(),
      userId: h.gestorId,
      userNome: h.gestor?.nome ?? null,
      userPerfil: h.gestor?.perfil ? String(h.gestor.perfil) : "",
      action: h.action,
      operation: h.action === "DELETE" ? "DELETE_OVERRIDE" : "MANUAL_EDIT",
      volumeFCTS: h.volumeFCTS,
      note: h.note,
      before: null,
      after: null,
      metadata: null,
    })),
    ...auditLogs.map((a) => ({
      type: "audit" as const,
      timestamp: a.createdAt.toISOString(),
      userId: a.userId,
      userNome: a.userNome,
      userPerfil: a.userPerfil ?? "",
      action: a.action,
      operation: (a.metadata as Record<string, unknown> | null)?.operation as string | undefined,
      volumeFCTS: undefined,
      note: undefined,
      before: a.before as Record<string, unknown> | null,
      after: a.after as Record<string, unknown> | null,
      metadata: a.metadata as Record<string, unknown> | null,
    })),
  ].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return normalized;
}
