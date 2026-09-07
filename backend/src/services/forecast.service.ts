import { RunStatus, Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import { getCycleOpenDay, getCycleOpenHour } from "./system-config.service.js";
import { businessDayAt } from "../utils/business-time.js";
import { appCache } from "../utils/cache.js";
import { logAudit } from "./audit.service.js";
import { AuditContext } from "../types/audit.js";
import * as SnapshotService from "./snapshot.service.js";

async function getUserSnapshot(userId: string | null): Promise<{ nome: string | null; perfil: string | null }> {
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

// ── ForecastRun ────────────────────────────────────────────────────────────

/**
 * Lista os runs de forecast.
 *
 * Para gestores e controladoria, filtra pelo dia de abertura configurável:
 *  - Se o run tiver `availableFrom` definido (override do Airflow), usa esse valor.
 *  - Caso contrário, calcula a data de abertura com base em `cycleOpenDay`
 *    (ex.: dia 5 do mês de referência do ciclo).
 *
 * Admins veem todos os runs independentemente da data.
 */
export const listRuns = async (options?: {
  refMonth?: string;
  perfil?: string;
  unidadeCodigos?: string[];
}) => {
  // operador_pcp and admin_ti see all SUCCESS runs regardless of availability
  const isAdmin = !options?.perfil || ["operador_pcp", "admin_ti"].includes(options.perfil);

  const where: Record<string, unknown> = { status: "SUCCESS" };
  if (options?.refMonth) where.refMonth = new Date(options.refMonth);

  const allRuns = await prisma.forecastRun.findMany({
    where:   where as any,
    orderBy: { executedAt: "desc" },
    include: { _count: { select: { items: true } } },
  });

  if (isAdmin) return allRuns;

  // For gestor/controladoria two visibility rules apply (OR logic):
  //
  // 1. OPEN WINDOW — cycle is currently open for editing:
  //    - If availableFrom IS SET: gate (9999-12-31 = blocked/not yet open)
  //    - If availableFrom IS NULL: legacy cycleOpenDay fallback
  //
  // 2. APPROVED CONSULTATION — gestor has an APPROVED submission for this cycle:
  //    - Always visible, read-only (UI enforces via isHistorical / submission.status)
  //    - Allows gestor to review past cycles regardless of availableFrom/Until
  const now          = new Date();
  const [cycleOpenDay, cycleOpenHour] = await Promise.all([getCycleOpenDay(), getCycleOpenHour()]);

  // Collect refMonths where the gestor's unit has an approved submission
  const approvedRefMonths = new Set<string>();
  if (options?.unidadeCodigos?.length) {
    const approvedSubs = await prisma.divisionSubmission.findMany({
      where: {
        unidadeVendaId: { in: options.unidadeCodigos },
        status: "APPROVED",
      },
      select: { refMonth: true },
    });
    for (const s of approvedSubs) {
      approvedRefMonths.add(s.refMonth.toISOString().substring(0, 7));
    }
  }

  return allRuns.filter((run) => {
    const runMonth = run.refMonth.toISOString().substring(0, 7);

    // Rule 2: always show cycles with an approved submission for this gestor
    if (approvedRefMonths.has(runMonth)) return true;

    // Rule 1: open window check
    // availableFrom has two distinct meanings:
    //   - Sentinel (>= 9000-01-01): cycle is CLOSED/BLOCKED — always visible for read-only consultation
    //   - Future-pending (< 9000-01-01 and > now): cycle not yet open — excluded from navigation
    //     (pending release date is exposed via GET /runs/next-release instead)
    if (run.availableFrom !== null) {
      const from           = run.availableFrom as Date;
      const SENTINEL_FLOOR = new Date("9000-01-01");

      if (from >= SENTINEL_FLOOR) return true; // closed/blocked sentinel — always show for consultation

      if (from > now) return false; // future-pending — exclude from navigation

      // Janela expirada: exibe como read-only para consulta (mesmo comportamento do sentinel).
      // O watchdog converterá availableFrom para 9999-12-31 na próxima execução;
      // até lá o ciclo não some da navegação.
      if (run.availableUntil && (run.availableUntil as Date) < now) return true;

      return true;
    }
    // Legacy fallback: cycle opens on day <cycleOpenDay> of the refMonth, at
    // <cycleOpenHour> in the business time zone (same rule as calcularJanelaDoCiclo).
    const ref         = run.refMonth;
    const daysInMonth = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0)).getUTCDate();
    const openDay     = Math.min(cycleOpenDay, daysInMonth);
    const openDate    = businessDayAt(ref.getUTCFullYear(), ref.getUTCMonth(), openDay, cycleOpenHour);
    return openDate <= now;
  });
};

export const createRun = async (data: {
  refMonth: string;
  status: RunStatus;
  windowStart?: string;
  windowEnd?: string;
  leadTimeMonths?: number;
  sourceKey?: string;
  artifactPath?: string;
}) => {
  // Deriva windowStart/windowEnd se não fornecidos (aplica lead time padrão)
  const refDate = new Date(data.refMonth);
  const lt = data.leadTimeMonths ?? 2;
  const derivedStart = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth() + lt, 1));
  const derivedEnd   = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth() + lt + 12, 1));
  // windowEnd = último mês (derivedStart + 11 meses = 12º mês da janela)
  derivedEnd.setUTCMonth(derivedEnd.getUTCMonth() - 1);

  const run = await prisma.forecastRun.create({
    data: {
      refMonth:      new Date(data.refMonth),
      status:        data.status,
      windowStart:   data.windowStart ? new Date(data.windowStart) : derivedStart,
      windowEnd:     data.windowEnd   ? new Date(data.windowEnd)   : derivedEnd,
      leadTimeMonths: lt,
      sourceKey:     data.sourceKey,
      artifactPath:  data.artifactPath,
    },
  });
  // Novo run invalida o mapa de runs em cache e todos os analytics derivados
  invalidateAnalyticsCache();
  return run;
};

export const finalizeRun = async (runId: string) => {
  const run = await prisma.forecastRun.update({
    where: { id: runId },
    data:  { status: "SUCCESS" },
    select: { id: true, status: true, refMonth: true, windowStart: true, windowEnd: true, leadTimeMonths: true },
  });

  // Herda produtos do ciclo anterior que a IA não cobriu.
  // Regra: um produto só sai do forecast quando o gestor o exclui (gestorExcluido = true).
  await _inheritPreviousCycleProducts(run);

  // Herda ForecastOverrides do ciclo anterior para todos os itens sem override no ciclo atual.
  // Garante que o export ao Protheus inclua produtos não re-confirmados pelo gestor.
  await _inheritPreviousCycleOverrides(run);

  invalidateAnalyticsCache();

  const _finalizeYear = run.refMonth.getUTCFullYear();
  void SnapshotService.refreshConsolidadoSnapshot(_finalizeYear,     undefined).catch(err => console.error("[finalizeRun] snapshot refresh failed:", err));
  void SnapshotService.refreshConsolidadoSnapshot(_finalizeYear + 1, undefined).catch(err => console.error("[finalizeRun] snapshot refresh year+1 failed:", err));

  return run;
};

/**
 * Após a IA finalizar um run, garante que todos os produtos do ciclo anterior
 * (gestorExcluido = false) estejam presentes no run atual.
 * Produtos não cobertos pela IA são criados com volumeIA = 0, source = "PREVIOUS_CYCLE".
 * Inclui paisIso3 no diff para cobrir unidades EXPORT corretamente.
 */
async function _inheritPreviousCycleProducts(run: {
  id: string;
  refMonth: Date;
  windowStart: Date | null;
  windowEnd:   Date | null;
  leadTimeMonths: number;
}): Promise<void> {
  // Encontra o run anterior mais recente (mês imediatamente antes)
  const prevRefMonth = new Date(
    Date.UTC(run.refMonth.getUTCFullYear(), run.refMonth.getUTCMonth() - 1, 1)
  );
  const prevRun = await prisma.forecastRun.findFirst({
    where:   { refMonth: prevRefMonth, status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
    select:  { id: true },
  });
  if (!prevRun) return; // primeiro ciclo do sistema — nada a herdar

  // Pares do ciclo anterior ativos (chave completa inclui paisIso3 para EXPORT)
  const prevPares = await prisma.forecastItem.findMany({
    where:  { runId: prevRun.id, gestorExcluido: false },
    select: { produtoId: true, unidadeVendaId: true, paisIso3: true },
    distinct: ["produtoId", "unidadeVendaId", "paisIso3"],
  });
  if (prevPares.length === 0) return;

  // Pares já presentes no run atual (inseridos pela IA)
  const currentPares = await prisma.forecastItem.findMany({
    where:  { runId: run.id },
    select: { produtoId: true, unidadeVendaId: true, paisIso3: true },
    distinct: ["produtoId", "unidadeVendaId", "paisIso3"],
  });
  const currentSet = new Set(
    currentPares.map(p => `${p.produtoId}|${p.unidadeVendaId}|${p.paisIso3 ?? ""}`)
  );

  // Diff: pares do ciclo anterior ausentes no run atual
  const missing = prevPares.filter(
    p => !currentSet.has(`${p.produtoId}|${p.unidadeVendaId}|${p.paisIso3 ?? ""}`)
  );
  if (missing.length === 0) return;

  // Determina janela de meses do run atual
  const lt    = run.leadTimeMonths ?? 2;
  const start = run.windowStart ?? new Date(
    Date.UTC(run.refMonth.getUTCFullYear(), run.refMonth.getUTCMonth() + lt, 1)
  );
  const months: Date[] = [];
  for (let i = 0; i < 12; i++) {
    months.push(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)));
  }

  // Cria ForecastItems herdados (volumeIA = 0, source = "PREVIOUS_CYCLE").
  // O diff já garante que nenhum desses pares existe no run atual, então usamos
  // create direto — sem risco de duplicata e sem o problema do Prisma 6 com
  // null em where de upsert em índice composto.
  const ops = missing.flatMap(p =>
    months.map(month =>
      prisma.forecastItem.create({
        data: {
          runId:          run.id,
          produtoId:      p.produtoId,
          unidadeVendaId: p.unidadeVendaId,
          month,
          paisIso3:       p.paisIso3,
          volumeIA:       0,
          source:         "PREVIOUS_CYCLE",
        },
      })
    )
  );

  // Executa em lotes para não saturar a pool de conexões (missing pode ser grande)
  const BATCH = 100;
  for (let i = 0; i < ops.length; i += BATCH) {
    await prisma.$transaction(ops.slice(i, i + BATCH));
  }

  console.log(
    `[finalizeRun] Herdados ${missing.length} par(es) produto×unidade×país do ciclo anterior` +
    ` (${missing.length * 12} ForecastItems criados com source=PREVIOUS_CYCLE)`
  );
}

/**
 * Após herdar os ForecastItems do ciclo anterior, copia os ForecastOverrides do ciclo N-1
 * para todos os itens do ciclo atual que ainda não possuem override.
 *
 * Isso garante que o export ao Protheus inclua todos os produtos — tanto os revisados
 * explicitamente pelo gestor no ciclo atual quanto os não-revisados (cujo valor FCTS é
 * o do ciclo anterior, exatamente como o frontend exibe via prevFctsMap).
 *
 * Duas passadas:
 *   1) Match calendárico: (produtoId, unidadeVendaId, paisIso3, mês) entre ciclo N e N-1.
 *   2) Carry do último mês: para itens que sobraram sem override (tipicamente o último
 *      mês da nova janela, ausente no ciclo anterior), copia o valor do mês imediatamente
 *      anterior do MESMO ciclo. Em ambas as passadas, valores 0 são ignorados.
 */
async function _inheritPreviousCycleOverrides(run: {
  id: string;
  refMonth: Date;
}): Promise<void> {
  const prevRefMonth = new Date(
    Date.UTC(run.refMonth.getUTCFullYear(), run.refMonth.getUTCMonth() - 1, 1)
  );
  const prevRun = await prisma.forecastRun.findFirst({
    where:   { refMonth: prevRefMonth, status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
    select:  { id: true },
  });
  if (!prevRun) return;

  // Itens do ciclo atual que ainda não possuem override
  const itemsWithoutOverride = await prisma.forecastItem.findMany({
    where:  { runId: run.id, gestorExcluido: false, overrides: { none: {} } },
    select: { id: true, produtoId: true, unidadeVendaId: true, paisIso3: true, month: true },
  });
  if (itemsWithoutOverride.length === 0) return;

  // Itens do ciclo anterior que possuem override — carregamos o override junto
  const prevItemsWithOverride = await prisma.forecastItem.findMany({
    where:  { runId: prevRun.id, gestorExcluido: false, overrides: { some: {} } },
    select: {
      produtoId:      true,
      unidadeVendaId: true,
      paisIso3:       true,
      month:          true,
      overrides: {
        take:    1,
        orderBy: { updatedAt: "desc" },
        select:  { volumeFCTS: true, gestorId: true },
      },
    },
  });

  // Índice: "produtoId|unidadeVendaId|paisIso3|YYYY-MM" → { volumeFCTS, gestorId }
  const prevMap = new Map<string, { volumeFCTS: number; gestorId: string | null }>();
  for (const pi of prevItemsWithOverride) {
    const mk  = pi.month.toISOString().substring(0, 7);
    const key = `${pi.produtoId}|${pi.unidadeVendaId}|${pi.paisIso3 ?? ""}|${mk}`;
    const ov  = pi.overrides[0];
    if (ov && ov.volumeFCTS > 0) prevMap.set(key, { volumeFCTS: ov.volumeFCTS, gestorId: ov.gestorId });
  }

  // Pares a criar: item atual sem override + match no ciclo anterior
  const toCreate: { forecastItemId: string; volumeFCTS: number; gestorId: string | null }[] = [];
  for (const ci of itemsWithoutOverride) {
    const mk  = ci.month.toISOString().substring(0, 7);
    const key = `${ci.produtoId}|${ci.unidadeVendaId}|${ci.paisIso3 ?? ""}|${mk}`;
    const prev = prevMap.get(key);
    if (prev) toCreate.push({ forecastItemId: ci.id, ...prev });
  }
  if (toCreate.length === 0) return;

  const BATCH = 100;
  const ops = toCreate.map(c =>
    prisma.forecastOverride.create({
      data: { forecastItemId: c.forecastItemId, volumeFCTS: c.volumeFCTS, gestorId: c.gestorId },
    })
  );
  for (let i = 0; i < ops.length; i += BATCH) {
    await prisma.$transaction(ops.slice(i, i + BATCH));
  }

  console.log(
    `[finalizeRun] Herdados ${toCreate.length} ForecastOverride(s) do ciclo anterior` +
    ` (${prevItemsWithOverride.length} overrides disponíveis no run ${prevRun.id})`
  );

  // ── Passada 2: carry do mês anterior do mesmo ciclo ────────────────────────
  // Itens do ciclo atual que continuam sem override após a passada 1 (típico:
  // último mês da nova janela). Para cada um, busca o override do mesmo
  // (produto, unidade, país) no mês imediatamente anterior do MESMO run.
  // Se esse mês anterior também estiver zerado, mantém zero.
  const stillWithoutOverride = await prisma.forecastItem.findMany({
    where:  { runId: run.id, gestorExcluido: false, overrides: { none: {} } },
    select: { id: true, produtoId: true, unidadeVendaId: true, paisIso3: true, month: true },
  });
  if (stillWithoutOverride.length === 0) return;

  // Mapa de overrides existentes no run atual (após passada 1):
  // "produtoId|unidadeVendaId|paisIso3|YYYY-MM" → { volumeFCTS, gestorId }
  const currentRunItems = await prisma.forecastItem.findMany({
    where:  { runId: run.id, gestorExcluido: false, overrides: { some: {} } },
    select: {
      produtoId:      true,
      unidadeVendaId: true,
      paisIso3:       true,
      month:          true,
      overrides: {
        take:    1,
        orderBy: { updatedAt: "desc" },
        select:  { volumeFCTS: true, gestorId: true },
      },
    },
  });
  const currentMap = new Map<string, { volumeFCTS: number; gestorId: string | null }>();
  for (const ci of currentRunItems) {
    const mk  = ci.month.toISOString().substring(0, 7);
    const key = `${ci.produtoId}|${ci.unidadeVendaId}|${ci.paisIso3 ?? ""}|${mk}`;
    const ov  = ci.overrides[0];
    if (ov && ov.volumeFCTS > 0) currentMap.set(key, { volumeFCTS: ov.volumeFCTS, gestorId: ov.gestorId });
  }

  const carryToCreate: { forecastItemId: string; volumeFCTS: number; gestorId: string | null }[] = [];
  for (const ci of stillWithoutOverride) {
    const prevMonth = new Date(Date.UTC(ci.month.getUTCFullYear(), ci.month.getUTCMonth() - 1, 1));
    const prevMk    = prevMonth.toISOString().substring(0, 7);
    const prevKey   = `${ci.produtoId}|${ci.unidadeVendaId}|${ci.paisIso3 ?? ""}|${prevMk}`;
    const prev      = currentMap.get(prevKey);
    if (prev) carryToCreate.push({ forecastItemId: ci.id, ...prev });
  }
  if (carryToCreate.length === 0) return;

  const carryOps = carryToCreate.map(c =>
    prisma.forecastOverride.create({
      data: { forecastItemId: c.forecastItemId, volumeFCTS: c.volumeFCTS, gestorId: c.gestorId },
    })
  );
  for (let i = 0; i < carryOps.length; i += BATCH) {
    await prisma.$transaction(carryOps.slice(i, i + BATCH));
  }

  console.log(
    `[finalizeRun] Carry do mês anterior: ${carryToCreate.length} ForecastOverride(s) criados` +
    ` (${stillWithoutOverride.length} itens sem override após passada 1)`
  );
}

export const latestSuccessfulRun = async (refMonth: string) => {
  return prisma.forecastRun.findFirst({
    where: { refMonth: new Date(refMonth), status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
  });
};

/**
 * Lista todos os runs (para administração — sem filtro de disponibilidade).
 */
export const listAllRuns = async () => {
  return prisma.forecastRun.findMany({
    where: { status: "SUCCESS" },
    orderBy: { refMonth: "asc" },
    include: { _count: { select: { items: true } } },
  });
};

/**
 * Atualiza o campo availableFrom de um run específico.
 * - null → limpa o override e volta a usar a regra global (cycleOpenDay)
 * - Date → define uma data de abertura explícita para este run
 */
export const updateRunAvailability = async (
  runId: string,
  availableFrom: Date | null
) => {
  return prisma.forecastRun.update({
    where: { id: runId },
    data: { availableFrom },
  });
};

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
    console.log(`[DEBUG-ADD][A1] getForecastItemsAnnual — CACHE HIT cacheKey=${cacheKey}`);
    return cached.data;
  }

  const run = await prisma.forecastRun.findFirst({
    where:   { refMonth: new Date(refMonth), status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
    select:  { id: true, windowStart: true, windowEnd: true, leadTimeMonths: true, refMonth: true },
  });
  console.log(`[DEBUG-ADD][A2] getForecastItemsAnnual — refMonth=${refMonth} runId resolvido=${run?.id ?? 'NOT FOUND'}`);
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


export const createItems = async (
  runId: string,
  items: Array<{
    produtoId: string;
    unidadeVendaId: string;
    month: string;
    volumeIA?: number;
    estoque?: number;
    source?: string;
    paisIso3?: string | null;
  }>
) => {
  // Prisma 6 não aceita null no where de upsert com compound unique index.
  // Produtos nacionais (paisIso3 = null) usam findFirst + update/create.
  const result = await prisma.$transaction(
    async (tx) => Promise.all(
      items.map(async (item) => {
        const paisIso3 = item.paisIso3 ?? null;
        const month    = new Date(item.month);

        if (paisIso3 !== null) {
          return tx.forecastItem.upsert({
            where: {
              runId_produtoId_unidadeVendaId_month_paisIso3: {
                runId,
                produtoId:      item.produtoId,
                unidadeVendaId: item.unidadeVendaId,
                month,
                paisIso3,
              },
            },
            create: {
              runId,
              produtoId:      item.produtoId,
              unidadeVendaId: item.unidadeVendaId,
              month,
              volumeIA:       item.volumeIA,
              estoque:        item.estoque,
              source:         item.source ?? "AIRFLOW",
              paisIso3,
            },
            update: { volumeIA: item.volumeIA, estoque: item.estoque },
          });
        }

        // paisIso3 = null: fallback para findFirst + update/create
        const existing = await tx.forecastItem.findFirst({
          where: {
            runId,
            produtoId:      item.produtoId,
            unidadeVendaId: item.unidadeVendaId,
            month,
            paisIso3:       null,
          },
          select: { id: true },
        });

        if (existing) {
          return tx.forecastItem.update({
            where: { id: existing.id },
            data:  { volumeIA: item.volumeIA, estoque: item.estoque },
          });
        }

        return tx.forecastItem.create({
          data: {
            runId,
            produtoId:      item.produtoId,
            unidadeVendaId: item.unidadeVendaId,
            month,
            volumeIA:       item.volumeIA,
            estoque:        item.estoque,
            source:         item.source ?? "AIRFLOW",
            paisIso3:       null,
          },
        });
      })
    ),
    { timeout: 30_000 }
  );
  invalidateAnalyticsCache();
  return result;
};

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

  const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

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
      const [year, month] = mk.split("-").map(Number);
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
    const [year, month] = mk.split("-").map(Number);
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
