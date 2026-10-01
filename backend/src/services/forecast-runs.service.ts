/**
 * Ciclo de vida do ForecastRun: listagem (com janela de liberação para gestores), criação, finalização com herança do ciclo anterior, inserção de itens e disponibilidade.
 * Extraído de forecast.service.ts — reexportado por ele para manter os imports existentes.
 */
import { RunStatus, Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import { getCycleOpenDay, getCycleOpenHour } from "./system-config.service.js";
import { businessDayAt } from "../utils/business-time.js";
import * as SnapshotService from "./snapshot.service.js";
import { invalidateAnalyticsCache } from "./forecast-shared.service.js";

// ── ForecastRun ────────────────────────────────────────────────────────────

/**
 * Lista os runs de forecast.
 *
 * Para gestores e consulta, filtra pelo dia de abertura configurável:
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

  const where: Prisma.ForecastRunWhereInput = { status: "SUCCESS" };
  if (options?.refMonth) where.refMonth = new Date(options.refMonth);

  const allRuns = await prisma.forecastRun.findMany({
    where,
    orderBy: { executedAt: "desc" },
    include: { _count: { select: { items: true } } },
  });

  if (isAdmin) return allRuns;

  // For gestor/consulta two visibility rules apply (OR logic):
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
