/**
 * Utilitários compartilhados pelos módulos de forecast: snapshot de autoria para auditoria, invalidação do cache analítico e mapa de runs SUCCESS.
 * Extraído de forecast.service.ts — reexportado por ele para manter os imports existentes.
 */
import prisma from "../config/prisma.js";
import { appCache } from "../utils/cache.js";

export async function getUserSnapshot(userId: string | null): Promise<{ nome: string | null; perfil: string | null }> {
  if (!userId) return { nome: null, perfil: null };
  const u = await prisma.user.findUnique({
    where:  { id: userId },
    select: { nome: true, perfil: true },
  });
  return { nome: u?.nome ?? null, perfil: u?.perfil ? String(u.perfil) : null };
}

export function invalidateAnalyticsCache(): void {
  appCache.invalidateAnalytics();
}

// ── ForecastRun map (TTL: 2 min) ───────────────────────────────────────────
/**
 * Devolve um Map<runId, executedAt> para todos os ForecastRuns com status SUCCESS.
 * Cacheado por 2 minutos para evitar query repetida a cada request de analytics.
 * Invalidado por invalidateAnalyticsCache() quando um novo run é criado.
 */
export async function getSuccessRunMap(): Promise<Map<string, Date>> {
  const cached = appCache.get("__runMap");
  if (cached && Date.now() < cached.expiresAt) return cached.data as Map<string, Date>;

  const runs = await prisma.forecastRun.findMany({
    where:  { status: "SUCCESS" },
    select: { id: true, executedAt: true },
  });
  const map = new Map(runs.map((r) => [r.id, r.executedAt]));
  appCache.set("__runMap", map, 2 * 60 * 1000);
  return map;
}
