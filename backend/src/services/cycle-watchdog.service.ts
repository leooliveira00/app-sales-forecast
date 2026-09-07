import prisma from "../config/prisma.js";
import { createForRole } from "./notification.service.js";
import { closeCycle } from "./cycle-readiness.service.js";
import { autoSubmitExpiredDrafts } from "./submission.service.js";
import { STALE_EXPORT_HOURS, failStaleExport } from "./protheus-export.service.js";

const PT_MONTHS = [
  "janeiro","fevereiro","março","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro",
];

function monthLabel(date: Date): string {
  return `${PT_MONTHS[date.getUTCMonth()]}/${date.getUTCFullYear()}`;
}

function formatDatetime(d: Date): string {
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Runs daily: detects cycles stuck in PENDING/PARTIAL for more than 24h,
 * notifies admin_ti, and dispatches CYCLE_OPENED notification when availableFrom is reached.
 */
export async function runWatchdog() {
  const now      = new Date();
  const cutoff24 = new Date(now.getTime() - 24 * 3_600_000);
  const cutoff6h = new Date(now.getTime() - 6  * 3_600_000);
  const monthStart = startOfMonth(now);

  // 1. Limpar ForecastRuns PROCESSING órfãos (> 6h sem finalização)
  const orphaned = await prisma.forecastRun.updateMany({
    where: { status: "PROCESSING", createdAt: { lt: cutoff6h } },
    data:  { status: "FAILED" },
  });
  if (orphaned.count > 0) {
    console.log(`[watchdog] Marked ${orphaned.count} orphaned PROCESSING run(s) as FAILED.`);
  }

  // 1b. Fechar ProtheusExportLogs travados em RUNNING
  // A DAG marca o log como SUCCESS/PARTIAL/FAILED no callback `finalize`. Se o worker
  // do Airflow morre antes disso, o log fica RUNNING para sempre: a tela do Protheus
  // exibe "em andamento" indefinidamente e o guard de envio único bloqueia novos
  // envios. Aqui esses logs são encerrados como FAILED.
  const staleExports = await prisma.protheusExportLog.findMany({
    where:  { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_EXPORT_HOURS * 3_600_000) } },
    select: { id: true, refMonth: true, startedAt: true },
  });
  for (const log of staleExports) {
    const horas = Math.floor((now.getTime() - log.startedAt.getTime()) / 3_600_000);
    await failStaleExport(log.id, horas);
    console.log(`[watchdog] ProtheusExportLog ${log.id} travado há ${horas}h — marcado como FAILED.`);
  }

  // 2. Auto-submit DRAFTs e fecha ciclos READY com availableUntil vencido
  const readyLogs = await prisma.cycleReadinessLog.findMany({
    where:  { gate: "READY" },
    select: { refMonth: true },
  });
  for (const log of readyLogs) {
    const run = await prisma.forecastRun.findFirst({
      where:  { refMonth: log.refMonth, status: "SUCCESS" },
      select: { availableUntil: true },
    });
    if (!run?.availableUntil || run.availableUntil >= now) continue;

    const label = log.refMonth.toISOString().slice(0, 7);
    try {
      // Submete DRAFTs com dados antes de fechar — garante rastreabilidade e
      // evita que o guard SUBMITTED_OPEN bloqueie o closeCycle em seguida.
      const { submitted, skipped } = await autoSubmitExpiredDrafts(log.refMonth);
      if (submitted.length > 0 || skipped.length > 0) {
        console.log(`[watchdog] Auto-submit ${label}: enviados=${submitted.join(",") || "nenhum"} ignorados=${skipped.join(",") || "nenhum"}`);
      }
    } catch (err) {
      console.error(`[watchdog] autoSubmitExpiredDrafts falhou para ${label}:`, err);
    }

    try {
      await closeCycle(
        log.refMonth.toISOString().slice(0, 10),
        null,
        "Encerrado automaticamente — janela de submissão expirada"
      );
      console.log(`[watchdog] Auto-closed cycle ${label}.`);
    } catch (err) {
      console.error(`[watchdog] closeCycle falhou para ${label}:`, err);
    }
  }

  // 3. Notificar gestores quando ciclo READY atinge availableFrom
  const ciclosParaNotificar = await prisma.cycleReadinessLog.findMany({
    where: { gate: "READY", gestorNotifiedAt: null },
    select: { refMonth: true },
  });

  for (const log of ciclosParaNotificar) {
    const run = await prisma.forecastRun.findFirst({
      where:  { refMonth: log.refMonth, status: "SUCCESS" },
      select: { availableFrom: true },
    });
    if (run?.availableFrom && run.availableFrom <= now) {
      const label = monthLabel(log.refMonth);
      await createForRole(
        "gestor",
        "CYCLE_OPENED",
        `Ciclo de ${label} aberto`,
        `O ciclo de ${label} está disponível para submissão. Acesse Meu Forecast para revisar e enviar seu forecast.`,
        log.refMonth
      );
      await prisma.cycleReadinessLog.update({
        where: { refMonth: log.refMonth },
        data:  { gestorNotifiedAt: now },
      });
      console.log(`[watchdog] Notified gestores: cycle ${log.refMonth.toISOString().slice(0, 7)} is open.`);
    }
  }

  // 4. Alertar admin_ti sobre ciclos presos em PENDING/PARTIAL/REPROCESSING > 24h
  const stuckCycles = await prisma.cycleReadinessLog.findMany({
    where: {
      gate:      { in: ["PENDING", "PARTIAL", "REPROCESSING"] },
      updatedAt: { lt: cutoff24 },
      createdAt: { gte: monthStart },
    },
  });

  let alertados = 0;

  for (const cycle of stuckCycles) {
    // Dedupe: o watchdog roda de hora em hora, mas o alerta de ciclo travado
    // continua sendo no máximo um por ciclo por dia. Sem isto, um ciclo parado
    // geraria 24 notificações diárias para cada admin_ti. A própria tabela de
    // notificações serve de registro — evita uma coluna nova só para isso.
    const jaAlertado = await prisma.notification.findFirst({
      where: {
        type:      "CYCLE_STUCK",
        refMonth:  cycle.refMonth,
        createdAt: { gte: cutoff24 },
      },
      select: { id: true },
    });
    if (jaAlertado) continue;

    const label       = monthLabel(cycle.refMonth);
    const hoursStuck  = Math.floor((now.getTime() - cycle.updatedAt.getTime()) / 3_600_000);

    await createForRole(
      "admin_ti",
      "CYCLE_STUCK",
      `Ciclo de ${label} sem progresso há ${hoursStuck}h`,
      `O ciclo está em ${cycle.gate} desde ${formatDatetime(cycle.updatedAt)}. Verifique se as DAGs obrigatórias estão em execução no Airflow.`,
      cycle.refMonth
    );
    alertados += 1;
  }

  return alertados;
}

/** Intervalo entre execuções do watchdog. */
const WATCHDOG_INTERVAL_MS = 3_600_000;   // 1 hora

/**
 * Starts the watchdog scheduler. Called once at server startup.
 *
 * Roda de hora em hora (antes: uma vez por dia às 08:00 do relógio do
 * container, que está em UTC — 05:00 no fuso de negócio). O gatilho da mudança
 * foi a notificação de abertura: com o ciclo liberando às 08h de Brasília, um
 * watchdog diário podia avisar os gestores só no dia seguinte. Passar a rodar de
 * hora em hora também encurta o fechamento automático da janela vencida e a
 * limpeza de runs/exports travados.
 *
 * Todas as etapas são idempotentes: as que agem gravam estado (status, gate,
 * `gestorNotifiedAt`) e saem do filtro na execução seguinte. A única que não
 * gravava — o alerta de ciclo travado — é limitada a um por ciclo a cada 24h
 * dentro de `runWatchdog`.
 */
export function startWatchdogScheduler() {
  const executar = async () => {
    try {
      const count = await runWatchdog();
      if (count > 0) console.log(`[watchdog] Alerted ${count} stuck cycle(s).`);
    } catch (err) {
      console.error("[watchdog] Error:", err);
    }
  };

  setInterval(() => { void executar(); }, WATCHDOG_INTERVAL_MS);
  void executar();   // primeira passada no boot, sem esperar a hora cheia

  console.log("[watchdog] Cycle watchdog scheduler started (hourly).");
}
