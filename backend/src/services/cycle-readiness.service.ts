import prisma from "../config/prisma.js";
import { getCycleOpenDay, getCycleCloseDay, getCycleOpenHour } from "./system-config.service.js";
import { triggerDag, getDag } from "./airflow.service.js";
import { createForRole } from "./notification.service.js";
import { businessDayAt, endOfBusinessDay, nextBusinessTimeAt } from "../utils/business-time.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const PT_MONTHS = [
  "janeiro","fevereiro","março","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro",
];

function toRefDate(refMonth: string): Date {
  const d = new Date(refMonth);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Janela de disponibilidade do ciclo para os gestores.
 *
 * **Abertura sempre no horário cheio de `cycleOpenHour` (08h) no fuso de
 * negócio**, nunca antes do dia `cycleOpenDay`. Se a prontidão chegar fora desse
 * horário, o ciclo aguarda a próxima ocorrência — pronto às 13h32 de 11/08 abre
 * em 12/08 às 08h. É o que torna a abertura previsível para comunicar aos
 * gestores; o custo é a espera de até um dia quando as DAGs atrasam.
 *
 * Cuidado com o fuso: `businessDayAt` resolve o horário de parede em Brasília e
 * devolve o instante UTC equivalente (08h BRT = 11h UTC). Usar `Date.UTC` aqui
 * abriria o ciclo às 21h do dia anterior — era o comportamento até 13/08/2026.
 */
const calcularJanelaDoCiclo = async (
  ref: Date
): Promise<{ availableFrom: Date; availableUntil: Date }> => {
  const [cycleOpenDay, cycleCloseDay, cycleOpenHour] = await Promise.all([
    getCycleOpenDay(),
    getCycleCloseDay(),
    getCycleOpenHour(),
  ]);

  const daysInMonth = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0)).getUTCDate();
  const openDay     = Math.min(cycleOpenDay,  daysInMonth);
  const closeDay    = Math.min(cycleCloseDay, daysInMonth);

  const minOpenDate = businessDayAt(ref.getUTCFullYear(), ref.getUTCMonth(), openDay, cycleOpenHour);
  const now         = new Date();

  return {
    availableFrom:  now <= minOpenDate ? minOpenDate : nextBusinessTimeAt(now, cycleOpenHour),
    availableUntil: endOfBusinessDay(ref.getUTCFullYear(), ref.getUTCMonth(), closeDay),
  };
};

function monthLabel(date: Date): string {
  return `${PT_MONTHS[date.getUTCMonth()]}/${date.getUTCFullYear()}`;
}

async function calcGate(
  steps: Record<string, string>,
  failedDag?: string
): Promise<"PENDING" | "PARTIAL" | "READY" | "FAILED"> {
  if (failedDag) return "FAILED";

  const requiredDags = await prisma.cycleRequiredDag.findMany({
    where: { enabled: true },
    select: { dagId: true },
  });

  if (requiredDags.length === 0) return "PENDING";

  const completedCount = requiredDags.filter((d) => steps[d.dagId]).length;
  if (completedCount === 0) return "PENDING";
  if (completedCount < requiredDags.length) return "PARTIAL";

  return "READY";
}

// ── Core functions ─────────────────────────────────────────────────────────────

export const getOrCreate = async (refMonth: string) => {
  const ref = toRefDate(refMonth);
  return prisma.cycleReadinessLog.upsert({
    where:  { refMonth: ref },
    create: { refMonth: ref },
    update: {},
  });
};

export const getReadinessForMonth = async (refMonth: Date | string) => {
  const ref = new Date(refMonth);
  return prisma.cycleReadinessLog.findUnique({
    where: { refMonth: new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)) },
    include: {
      blockedBy:   { select: { id: true, nome: true, email: true } },
      unblockedBy: { select: { id: true, nome: true, email: true } },
    },
  });
};

export const listRecent = async (n = 6) => {
  const logs = await prisma.cycleReadinessLog.findMany({
    orderBy: { refMonth: "desc" },
    take:    n,
    include: {
      blockedBy:   { select: { id: true, nome: true, email: true } },
      unblockedBy: { select: { id: true, nome: true, email: true } },
    },
  });

  const dags = await prisma.cycleRequiredDag.findMany({ orderBy: { order: "asc" } });
  return logs.map((l) => ({ ...l, dags }));
};

// ── getOverview ────────────────────────────────────────────────────────────────

function isoMonth(d: Date): string {
  return d.toISOString().substring(0, 7);
}

/**
 * Retorna uma visão consolidada dos ciclos para a página de monitoramento.
 * Cobre pastMonths meses anteriores + mês atual + futureMonths meses futuros.
 * Meses sem CycleReadinessLog aparecem com gate "NOT_STARTED".
 */
export const getOverview = async (pastMonths = 6, futureMonths = 2) => {
  const now         = new Date();
  const currentRef  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Gera slots do mais recente (futuro) para o mais antigo (passado)
  const refMonths: Date[] = [];
  for (let i = futureMonths; i >= -pastMonths; i--) {
    refMonths.push(new Date(Date.UTC(currentRef.getUTCFullYear(), currentRef.getUTCMonth() + i, 1)));
  }

  const [logs, dags, runs, subGroups, closeDay, totalActiveUnits] = await Promise.all([
    prisma.cycleReadinessLog.findMany({
      where:   { refMonth: { in: refMonths } },
      include: { blockedBy: { select: { id: true, nome: true, email: true } } },
    }),
    prisma.cycleRequiredDag.findMany({ orderBy: { order: "asc" } }),
    prisma.forecastRun.findMany({
      where:   { refMonth: { in: refMonths }, status: { in: ["SUCCESS", "PROCESSING"] } },
      include: { _count: { select: { items: true } } },
      orderBy: { executedAt: "desc" },
    }),
    prisma.divisionSubmission.groupBy({
      by:    ["refMonth", "status"],
      where: { refMonth: { in: refMonths } },
      _count: { id: true },
    }),
    getCycleCloseDay(),
    prisma.unidadeVenda.count({ where: { ativo: true } }),
  ]);

  // Busca próxima execução agendada de cada DAG diretamente do Airflow (best-effort)
  const airflowNextByDagId = new Map<string, string | null>();
  await Promise.all(
    dags.map(async (d) => {
      const info = await getDag(d.dagId).catch(() => null);
      airflowNextByDagId.set(d.dagId, info?.next_dagrun_data_interval_start ?? null);
    })
  );

  // Dia de execução: extraído do Airflow. Null quando Airflow está inacessível.
  const firstAirflowNext = dags.map(d => airflowNextByDagId.get(d.dagId)).find(v => v != null) ?? null;
  const scheduledDay = firstAirflowNext ? new Date(firstAirflowNext).getUTCDate() : null;

  const logByKey = new Map(logs.map((l) => [isoMonth(l.refMonth), l]));

  const runByKey = new Map<string, (typeof runs)[0]>();
  for (const r of runs) {
    const k = isoMonth(r.refMonth);
    if (!runByKey.has(k)) runByKey.set(k, r); // first = most recent (desc order)
  }

  const subsByKey = new Map<string, Record<string, number>>();
  for (const g of subGroups) {
    const k = isoMonth(g.refMonth as Date);
    if (!subsByKey.has(k)) subsByKey.set(k, {});
    subsByKey.get(k)![g.status] = g._count.id;
  }

  const currentKey = isoMonth(currentRef);

  return refMonths.map((slot) => {
    const key  = isoMonth(slot);
    const log  = logByKey.get(key);
    const run  = runByKey.get(key);
    const subs = subsByKey.get(key);

    const subMap = subs ?? {};

    return {
      refMonth:         slot.toISOString(),
      isCurrent:        key === currentKey,
      isPast:           slot < currentRef,
      isFuture:         slot > currentRef,
      scheduledDagDate: scheduledDay !== null
        ? new Date(Date.UTC(slot.getUTCFullYear(), slot.getUTCMonth(), scheduledDay)).toISOString()
        : null,
      closeDate:        endOfBusinessDay(slot.getUTCFullYear(), slot.getUTCMonth(), closeDay).toISOString(),
      gate:             log?.gate ?? "NOT_STARTED",
      stepsCompleted:   (log?.stepsCompleted ?? {}) as Record<string, string>,
      blockedAt:        log?.blockedAt?.toISOString()   ?? null,
      blockedReason:    log?.blockedReason              ?? null,
      blockedBy:        log?.blockedBy                  ?? null,
      retryCount:       log?.retryCount                 ?? 0,
      logUpdatedAt:     log?.updatedAt?.toISOString()   ?? null,
      dags: dags.map(d => ({ ...d, nextScheduledAt: airflowNextByDagId.get(d.dagId) ?? null })),
      forecastRun: run ? {
        id:             run.id,
        itemCount:      run._count.items,
        availableFrom:  run.availableFrom?.toISOString()  ?? null,
        availableUntil: run.availableUntil?.toISOString() ?? null,
        executedAt:     run.executedAt.toISOString(),
      } : null,
      submissions: totalActiveUnits > 0 ? {
        total:     totalActiveUnits,
        draft:     subMap["DRAFT"]     ?? 0,
        submitted: subMap["SUBMITTED"] ?? 0,
        approved:  subMap["APPROVED"]  ?? 0,
        rejected:  subMap["REJECTED"]  ?? 0,
      } : null,
    };
  });
};

export const markStep = async (
  refMonth: string,
  dagId: string,
  dagRunId: string,
  state: "success" | "failed"
) => {
  const ref = toRefDate(refMonth);

  let newGate: string = "PENDING";

  await prisma.$transaction(async (tx) => {
    // Garantir que o log exista antes do lock (callbacks podem chegar antes da criação manual)
    await tx.cycleReadinessLog.upsert({
      where:  { refMonth: ref },
      create: { refMonth: ref },
      update: {},
    });

    // Pessimistic lock on this cycle row
    await tx.$executeRaw`
      SELECT id FROM "CycleReadinessLog"
      WHERE "refMonth" = ${ref}
      FOR UPDATE
    `;

    const log = await tx.cycleReadinessLog.findUnique({ where: { refMonth: ref } });
    if (!log) return;

    const expectedRunIds = (log.expectedDagRunIds ?? {}) as Record<string, string>;
    const completedSteps = (log.stepsCompleted  ?? {}) as Record<string, string>;

    if (log.gate === "CLOSED") {
      return;
    }

    if (log.gate === "BLOCKED") {
      // Acumular step concluído mas não avançar o gate — unblockCycle recalculará depois
      if (state === "success") {
        const completedSteps = (log.stepsCompleted ?? {}) as Record<string, string>;
        if (!completedSteps[dagId]) {
          await tx.cycleReadinessLog.update({
            where: { refMonth: ref },
            data:  { stepsCompleted: { ...completedSteps, [dagId]: new Date().toISOString() } },
          });
        }
      }
      return;
    }

    // Idempotency: se o step já foi concluído e nenhum re-run foi explicitamente agendado
    // via rerunCycle (expectedRunIds vazio = execução manual ou ciclo normal sem pendência),
    // ignora o callback. Protege contra re-execução automática do Airflow no dia do ciclo.
    if (completedSteps[dagId] && (!expectedRunIds[dagId] || expectedRunIds[dagId] === dagRunId)) return;

    // Stale callback check
    if (expectedRunIds[dagId] && expectedRunIds[dagId] !== dagRunId) return;

    const newSteps = state === "success"
      ? { ...completedSteps, [dagId]: new Date().toISOString() }
      : completedSteps;

    newGate = await calcGate(newSteps, state === "failed" ? dagId : undefined);

    const data: Record<string, unknown> = {
      stepsCompleted: newSteps,
      gate:           newGate,
    };

    if (newGate === "READY") {
      // Verificar se ciclo anterior ainda possui submissões abertas
      const prevRef   = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
      const openSubs  = await tx.divisionSubmission.count({
        where: { refMonth: prevRef, status: { in: ["DRAFT", "SUBMITTED"] } },
      });
      if (openSubs > 0) {
        newGate = "AWAITING_PREV_CLOSE";
      } else {
        const { availableFrom, availableUntil } = await calcularJanelaDoCiclo(ref);

        await tx.forecastRun.updateMany({
          where: { refMonth: ref, status: "SUCCESS" },
          data:  { availableFrom, availableUntil },
        });
      }
    }

    data.gate = newGate;

    await tx.cycleReadinessLog.update({ where: { refMonth: ref }, data });
  }, { isolationLevel: "Serializable" });

  // Notifications outside transaction
  // Notificação de abertura é responsabilidade do watchdog (roda diariamente às 8h),
  // que dispara apenas quando availableFrom for atingido. Isso evita notificar gestores
  // antes do ciclo estar de fato acessível.

  if (newGate === "AWAITING_PREV_CLOSE") {
    const prevRef = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
    await createForRole(
      "operador_pcp",
      "CYCLE_AWAITING_PREV_CLOSE",
      `Ciclo de ${monthLabel(ref)} aguardando fechamento do ciclo anterior`,
      `O ciclo de ${monthLabel(ref)} está pronto (todas as DAGs concluíram), mas o ciclo de ${monthLabel(prevRef)} ainda possui submissões em aberto (DRAFT ou SUBMITTED). O ciclo será aberto automaticamente assim que todas as submissões do ciclo anterior forem aprovadas ou rejeitadas.`,
      ref
    );
  }

  if (newGate === "FAILED") {
    await createForRole(
      "gestor",
      "CYCLE_FAILED",
      `Erro na preparação do ciclo de ${monthLabel(ref)}`,
      `Ocorreu um erro na preparação do ciclo de ${monthLabel(ref)}. Aguarde a equipe de TI.`,
      ref
    );
  }

  return newGate;
};

/**
 * Promove um ciclo de AWAITING_PREV_CLOSE para READY, abrindo-o para gestores.
 * Chamado automaticamente quando a última submissão do ciclo anterior é encerrada.
 */
export const promoteToReady = async (refMonth: Date | string) => {
  const ref = typeof refMonth === "string" ? toRefDate(refMonth) : refMonth;

  const { availableFrom, availableUntil } = await calcularJanelaDoCiclo(ref);

  await prisma.$transaction([
    prisma.cycleReadinessLog.updateMany({
      where: { refMonth: ref, gate: "AWAITING_PREV_CLOSE" },
      data:  { gate: "READY" },
    }),
    prisma.forecastRun.updateMany({
      where: { refMonth: ref, status: "SUCCESS" },
      data:  { availableFrom, availableUntil },
    }),
  ]);

  await createForRole(
    "gestor",
    "CYCLE_OPENED",
    `Ciclo de ${monthLabel(ref)} aberto`,
    `O ciclo de ${monthLabel(ref)} está disponível para submissão. Acesse Meu Forecast para revisar e enviar seu forecast.`,
    ref
  );
};

export const blockCycle = async (
  refMonth: string,
  userId: string,
  reason: string
) => {
  const ref = toRefDate(refMonth);

  const log = await prisma.cycleReadinessLog.upsert({
    where:  { refMonth: ref },
    create: {
      refMonth:      ref,
      gate:          "BLOCKED",
      blockedAt:     new Date(),
      blockedById:   userId,
      blockedReason: reason,
    },
    update: {
      gate:          "BLOCKED",
      blockedAt:     new Date(),
      blockedById:   userId,
      blockedReason: reason,
    },
  });

  // Hide run from gestores
  await prisma.forecastRun.updateMany({
    where: { refMonth: ref, status: "SUCCESS" },
    data:  { availableFrom: new Date("9999-12-31") },
  });

  // Revert SUBMITTED submissions to DRAFT
  await prisma.divisionSubmission.updateMany({
    where: { refMonth: ref, status: "SUBMITTED" },
    data:  { status: "DRAFT" },
  });

  // Mark APPROVED submissions as needing review
  await prisma.divisionSubmission.updateMany({
    where: { refMonth: ref, status: "APPROVED" },
    data:  { needsReview: true },
  });

  // Notify gestores
  await createForRole(
    "gestor",
    "CYCLE_BLOCKED",
    `Ciclo de ${monthLabel(ref)} bloqueado`,
    `O ciclo de ${monthLabel(ref)} foi temporariamente bloqueado. Motivo: ${reason}. Suas submissões enviadas foram revertidas para rascunho. Você será notificado quando o ciclo for reaberto.`,
    ref
  );

  return log;
};

export const rerunCycle = async (
  refMonth: string,
  userId: string,
  dags: string[],
  reason: string
) => {
  const ref = toRefDate(refMonth);

  // Invalidar SUCCESS e PROCESSING (previne dois runs simultâneos para o mesmo refMonth)
  await prisma.forecastRun.updateMany({
    where: { refMonth: ref, status: { in: ["SUCCESS", "PROCESSING"] } },
    data:  { status: "FAILED", availableFrom: new Date("9999-12-31") },
  });

  // Reverter SUBMITTED → DRAFT (dados serão substituídos pelo reprocessamento)
  await prisma.divisionSubmission.updateMany({
    where: { refMonth: ref, status: "SUBMITTED" },
    data:  { status: "DRAFT" },
  });

  // Marcar APPROVED com needsReview (dados aprovados ficam stale após reprocessamento)
  await prisma.divisionSubmission.updateMany({
    where: { refMonth: ref, status: "APPROVED" },
    data:  { needsReview: true },
  });

  const log = await prisma.cycleReadinessLog.findUnique({ where: { refMonth: ref } });
  const currentSteps = (log?.stepsCompleted ?? {}) as Record<string, string>;
  const newSteps: Record<string, string> = { ...currentSteps };
  for (const dagId of dags) delete newSteps[dagId];

  // Dispara a DAG orquestradora que executa as DAGs filhas em sequência:
  // produtos_sync → vendas_sync → forecast_run.
  // Cada DAG filha envia seu próprio callback ao backend ao finalizar,
  // avançando o stepsCompleted normalmente.
  // O expectedDagRunIds registra os IDs das DAGs filhas para validação
  // dos callbacks — obtidos diretamente do Airflow após o trigger.
  const ORCHESTRATOR_DAG_ID = "protheus_cycle_reprocess";

  // Remove os IDs das DAGs que serão reprocessadas. O orquestrador dispara as
  // filhas de forma assíncrona, então qualquer consulta ao Airflow feita aqui
  // retornaria o run anterior — registrando um ID errado que faria os callbacks
  // reais serem rejeitados silenciosamente. Sem expectedRunId, o markStep aceita
  // o callback de qualquer run (fallback: expectedRunIds[dagId] === undefined).
  const currentExpected = (log?.expectedDagRunIds ?? {}) as Record<string, string>;
  const newExpectedRunIds: Record<string, string> = { ...currentExpected };
  for (const dagId of dags) delete newExpectedRunIds[dagId];

  try {
    await triggerDag(ORCHESTRATOR_DAG_ID, { refMonth, rerunReason: reason });
  } catch (err) {
    console.error(`[rerunCycle] Failed to trigger orchestrator DAG ${ORCHESTRATOR_DAG_ID}:`, err);
    throw err;
  }

  const blocker = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  return prisma.cycleReadinessLog.update({
    where: { refMonth: ref },
    data: {
      gate:              "REPROCESSING",
      stepsCompleted:    newSteps,
      expectedDagRunIds: newExpectedRunIds,
      retryCount:        { increment: 1 },
      rerunReason:       reason,
      unblockedAt:       new Date(),
      unblockedById:     userId,
      triggeredBy:       `manual:${blocker?.email ?? userId}`,
    },
  });
};

export const closeCycle = async (
  refMonth: string,
  userId: string | null,
  reason: string
) => {
  const ref = toRefDate(refMonth);

  // Guard: não encerrar com submissões aguardando aprovação
  const submittedCount = await prisma.divisionSubmission.count({
    where: { refMonth: ref, status: "SUBMITTED" },
  });
  if (submittedCount > 0) {
    throw Object.assign(
      new Error(`Existem ${submittedCount} submissão(ões) aguardando aprovação do PCP. Aprove ou rejeite antes de encerrar o ciclo.`),
      { code: "SUBMITTED_OPEN" }
    );
  }

  await prisma.$transaction([
    prisma.cycleReadinessLog.updateMany({
      where: { refMonth: ref },
      data:  { gate: "CLOSED", blockedReason: reason },
    }),
    prisma.forecastRun.updateMany({
      where: { refMonth: ref, status: "SUCCESS" },
      data:  { availableFrom: new Date("9999-12-31") },
    }),
  ]);

  await createForRole(
    "gestor",
    "CYCLE_CLOSED",
    `Ciclo de ${monthLabel(ref)} encerrado`,
    `O ciclo de ${monthLabel(ref)} foi encerrado. Os dados permanecem disponíveis para consulta.`,
    ref
  );
};

export const unblockCycle = async (
  refMonth: string,
  userId: string,
  note?: string
) => {
  const ref = toRefDate(refMonth);

  const log = await prisma.cycleReadinessLog.findUnique({ where: { refMonth: ref } });
  const currentSteps = (log?.stepsCompleted ?? {}) as Record<string, string>;

  // Recalcular gate baseado nos steps já completos (PENDING, PARTIAL ou READY)
  const recalcGate = await calcGate(currentSteps);

  if (recalcGate === "READY") {
    // Restaurar janela do ForecastRun para gestores
    const { availableFrom, availableUntil } = await calcularJanelaDoCiclo(ref);

    await prisma.forecastRun.updateMany({
      where: { refMonth: ref, status: "SUCCESS" },
      data:  { availableFrom, availableUntil },
    });

    await createForRole(
      "gestor",
      "CYCLE_OPENED",
      `Ciclo de ${monthLabel(ref)} reaberto`,
      `O ciclo de ${monthLabel(ref)} foi desbloqueado e está disponível para submissão.`,
      ref
    );
  }

  return prisma.cycleReadinessLog.update({
    where: { refMonth: ref },
    data: {
      gate:          recalcGate,
      unblockedAt:   new Date(),
      unblockedById: userId,
      rerunReason:   note ?? null,
    },
  });
  // Se recalcGate = PENDING ou PARTIAL: availableFrom permanece 9999 até markStep avançar para READY
};

// ── Orchestrator-level failure ────────────────────────────────────────────────

/**
 * Força gate = FAILED para ciclos travados em REPROCESSING quando a DAG
 * orquestradora falha antes de disparar qualquer DAG filha (sem callback chegar).
 * Idempotente: ignora se o ciclo já está em FAILED ou CLOSED.
 */
export const forceFailCycle = async (refMonth: string): Promise<void> => {
  const ref = toRefDate(refMonth);

  const updated = await prisma.cycleReadinessLog.updateMany({
    where: {
      refMonth: ref,
      gate: { notIn: ["FAILED", "CLOSED"] },
    },
    data: { gate: "FAILED" },
  });

  if (updated.count === 0) return; // já estava em FAILED/CLOSED, nada a fazer

  await createForRole(
    "gestor",
    "CYCLE_FAILED",
    `Erro na preparação do ciclo de ${monthLabel(ref)}`,
    `Ocorreu um erro na preparação do ciclo de ${monthLabel(ref)}. Aguarde a equipe de TI.`,
    ref
  );
};

// ── Gate check helper ─────────────────────────────────────────────────────────

export const assertCycleReady = async (refMonth: Date | string) => {
  const ref = new Date(refMonth);
  const log = await getReadinessForMonth(ref);

  if (!log || log.gate === "CLOSED") {
    return {
      blocked: true,
      error:   "CYCLE_CLOSED",
      message: "Este ciclo foi encerrado.",
      blockedAt: null,
      blockedBy: null,
      gate:    log?.gate ?? "PENDING",
    };
  }

  if (log.gate !== "READY") {
    return {
      blocked: true,
      error:   "CYCLE_BLOCKED",
      message: log?.blockedReason ?? "O ciclo está temporariamente indisponível.",
      blockedAt: log?.blockedAt ?? null,
      blockedBy: (log?.blockedBy as { nome?: string } | null)?.nome ?? null,
      gate:    log.gate,
    };
  }

  // Gate é READY — verificar se a janela do ForecastRun está ativa
  const run = await prisma.forecastRun.findFirst({
    where:  { refMonth: new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)), status: "SUCCESS" },
    select: { availableFrom: true, availableUntil: true },
  });
  const now = new Date();
  if (run?.availableFrom && run.availableFrom > now) {
    return {
      blocked: true,
      error:   "CYCLE_NOT_YET_OPEN",
      message: "O ciclo ainda não está aberto para submissão.",
      blockedAt: null,
      blockedBy: null,
      gate:    "READY" as const,
    };
  }
  if (run?.availableUntil && run.availableUntil < now) {
    return {
      blocked: true,
      error:   "CYCLE_EXPIRED",
      message: "O prazo de submissão deste ciclo encerrou.",
      blockedAt: null,
      blockedBy: null,
      gate:    "READY" as const,
    };
  }

  return { blocked: false };
};
