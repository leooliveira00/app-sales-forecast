import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import * as AirflowService from "./airflow.service.js";
import { createForRole } from "./notification.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DAG_ID = "protheus_forecast_export";

/**
 * Tempo após o qual um envio parado em RUNNING é considerado travado.
 *
 * O status final vem do callback `finalize` da DAG; se o worker do Airflow morre
 * antes disso, o log fica RUNNING para sempre — a tela exibe "em andamento"
 * indefinidamente e o guard de envio único bloqueia qualquer novo envio.
 * Os envios completos observados levam ~1h (10 mil itens, com DELETE mensal e
 * conferência de gravação), daí a folga até 3h.
 */
export const STALE_EXPORT_HOURS = 3;

const PT_MONTHS = [
  "janeiro","fevereiro","março","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro",
];

const monthLabel = (d: Date) => `${PT_MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}`;

/**
 * Notifica operador_pcp e admin_ti sobre o desfecho de um envio ao Protheus.
 * O envio leva perto de uma hora; sem isso, só quem estiver com a tela aberta
 * descobre o resultado.
 */
const notifyExportResult = async (
  logId:    string,
  refMonth: Date,
  status:   "SUCCESS" | "PARTIAL" | "FAILED",
  resumo:   string
): Promise<void> => {
  const label = monthLabel(refMonth);
  const titulo =
    status === "SUCCESS" ? `Forecast de ${label} enviado ao Protheus`
    : status === "PARTIAL" ? `Envio de ${label} ao Protheus concluído com pendências`
    : `Falha no envio de ${label} ao Protheus`;

  for (const perfil of ["operador_pcp", "admin_ti"] as const) {
    await createForRole(
      perfil,
      `PROTHEUS_EXPORT_${status}`,
      titulo,
      `${resumo} Consulte a tela Protheus para o detalhamento (envio ${logId}).`,
      refMonth
    ).catch((err) => console.error("[protheus-export] falha ao notificar:", err));
  }
};

/**
 * Encerra como FAILED um envio travado em RUNNING, liberando a tela e o guard de
 * envio único. Chamado pelo watchdog e antes de disparar um novo envio.
 */
export const failStaleExport = async (logId: string, horasParado: number): Promise<void> => {
  const motivo =
    `Envio interrompido sem retorno do Airflow — nenhuma finalização recebida em ${horasParado}h. ` +
    `Verifique o run da DAG antes de reenviar.`;

  await prisma.protheusExportItem.updateMany({
    where: { logId, status: "PENDING" },
    data:  { status: "FAILED", error: motivo },
  });

  // unidadesOk/Failed derivados dos itens: o callback que traria esses números não veio
  const porUnidade = await prisma.protheusExportItem.groupBy({
    by:    ["unidadeVendaId", "status"],
    where: { logId },
    _count: { id: true },
  });
  const comSucesso = new Set(porUnidade.filter((g) => g.status === "SUCCESS").map((g) => g.unidadeVendaId));
  const comFalha   = new Set(porUnidade.filter((g) => g.status === "FAILED").map((g) => g.unidadeVendaId));

  const log = await prisma.protheusExportLog.update({
    where: { id: logId },
    data:  {
      status:         "FAILED",
      finishedAt:     new Date(),
      unidadesOk:     comSucesso.size,
      unidadesFailed: comFalha.size,
      errorMessage:   motivo,
    },
    select: { refMonth: true },
  });

  await notifyExportResult(
    logId,
    log.refMonth,
    "FAILED",
    `O envio parou sem retorno do Airflow há ${horasParado}h. ` +
    `${comSucesso.size} unidade(s) chegaram a ser enviadas e ${comFalha.size} ficaram pendentes.`
  );
};

// ── Tipos internos ─────────────────────────────────────────────────────────────

export interface ApprovedForecastItem {
  unidadeVendaId: string;
  month:          string;   // "YYYYMM"
  produtoId:      string;
  codigoFamilia:  string | null;
  volumeFCTS:     number;
  forecastItemId: string;
  overrideId:     string;
  exportItemId?:  string;   // preenchido após criação de ProtheusExportItem
}

export interface MonthExportDetail {
  month:     string;   // "YYYYMM"
  status:    "SUCCESS" | "FAILED" | "PENDING";
  itemCount: number;
  attempt:   number;
  error?:    string;
}

export interface UnitExportDetail {
  unidadeVendaId: string;
  deleteStatus:   "SUCCESS" | "FAILED" | "PENDING";
  overallStatus:  "SUCCESS" | "PARTIAL" | "FAILED" | "PENDING";
  meses:          MonthExportDetail[];
  error?:         string;
}

// ── Consulta de dados aprovados ────────────────────────────────────────────────

export const getApprovedForecastData = async (
  refMonth: string
): Promise<{ run: { id: string; windowStart: Date | null; windowEnd: Date | null }; items: ApprovedForecastItem[] }> => {
  const refDate = new Date(refMonth);

  const run = await prisma.forecastRun.findFirst({
    where:   { refMonth: refDate, status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
    select:  { id: true, windowStart: true, windowEnd: true },
  });
  if (!run) throw new Error(`ForecastRun SUCCESS não encontrado para ${refMonth}`);

  const approvedSubs = await prisma.divisionSubmission.findMany({
    where:  { refMonth: refDate, status: "APPROVED" },
    select: { unidadeVendaId: true },
  });
  if (approvedSubs.length === 0) throw new Error(`Nenhuma DivisionSubmission APPROVED para ${refMonth}`);

  const approvedUnits = approvedSubs.map((s) => s.unidadeVendaId);

  const forecastItems = await prisma.forecastItem.findMany({
    where: {
      runId:          run.id,
      gestorExcluido: false,
      unidadeVendaId: { in: approvedUnits },
    },
    include: {
      overrides: { take: 1, orderBy: { updatedAt: "desc" } },
      produto:   {
        include: {
          unidades: {
            select: { codigoFamilia: true, unidadeVendaId: true },
          },
        },
      },
    },
  });

  // Para unidades EXPORT cada produto tem um ForecastItem por país — agregamos
  // por unidadeVenda+produto+mês somando volumes antes de montar os itens finais.
  const aggMap = new Map<string, ApprovedForecastItem>();

  for (const fi of forecastItems) {
    const override = fi.overrides[0];
    if (!override?.volumeFCTS || override.volumeFCTS <= 0) continue;

    const unidadeLink = fi.produto.unidades.find((u) => u.unidadeVendaId === fi.unidadeVendaId);
    const monthStr    = fi.month.toISOString().substring(0, 7).replace("-", ""); // "YYYYMM"
    const aggKey      = `${fi.unidadeVendaId}|${fi.produtoId}|${monthStr}`;

    const existing = aggMap.get(aggKey);
    if (existing) {
      existing.volumeFCTS += override.volumeFCTS;
    } else {
      aggMap.set(aggKey, {
        unidadeVendaId: fi.unidadeVendaId,
        month:          monthStr,
        produtoId:      fi.produtoId,
        codigoFamilia:  unidadeLink?.codigoFamilia ?? null,
        volumeFCTS:     override.volumeFCTS,
        forecastItemId: fi.id,
        overrideId:     override.id,
      });
    }
  }

  const items: ApprovedForecastItem[] = [...aggMap.values()];

  return { run, items };
};

// ── Trigger principal (cria log + items + aciona DAG) ─────────────────────────

/**
 * Dispara a exportação de forecast para o Protheus.
 *
 * Modos de operação:
 * - Sem opções: envia todas as unidades com DivisionSubmission APPROVED
 * - options.unidadeVendaIds: envia apenas as unidades especificadas (devem ser APPROVED)
 * - options.retryFromLogId: reprocessa apenas as unidades FAILED/PARTIAL do log anterior
 *
 * Não exige mais que TODAS as unidades estejam aprovadas — apenas as selecionadas
 * precisam estar APPROVED. Isso permite envios modulares (unidade por unidade) para
 * testes e envios parciais quando parte do ciclo já foi aprovada.
 */
export const triggerExport = async (
  refMonth:      string,
  triggeredById: string,
  options?: {
    retryFromLogId?:  string;    // reprocessa unidades FAILED/PARTIAL do log anterior
    unidadeVendaIds?: string[];  // envia apenas estas unidades (devem ser APPROVED)
  }
): Promise<{ logId: string }> => {
  const refDate          = new Date(refMonth);
  const retryFromLogId   = options?.retryFromLogId;
  const unidadeVendaIds  = options?.unidadeVendaIds;

  // Guard: nenhum export RUNNING para o mesmo ciclo.
  // Log travado (DAG morreu sem chamar `finalize`) é encerrado aqui em vez de
  // bloquear novos envios até o watchdog rodar.
  const running = await prisma.protheusExportLog.findFirst({
    where: { refMonth: refDate, status: "RUNNING" },
  });
  if (running) {
    const horasParado = Math.floor((Date.now() - running.startedAt.getTime()) / 3_600_000);
    if (horasParado < STALE_EXPORT_HOURS) {
      throw new Error(`Já existe um envio em andamento para ${refMonth} (logId=${running.id})`);
    }
    console.warn(
      `[protheus-export] Log ${running.id} em RUNNING há ${horasParado}h sem finalização — ` +
      `encerrando como FAILED para liberar o novo envio.`
    );
    await failStaleExport(running.id, horasParado);
  }

  // Guard: ForecastRun SUCCESS existe
  const run = await prisma.forecastRun.findFirst({
    where: { refMonth: refDate, status: "SUCCESS" },
  });
  if (!run) {
    throw new Error(`Nenhum ForecastRun com status SUCCESS encontrado para ${refMonth}`);
  }

  // Guard de unidades selecionadas — cada uma deve estar APPROVED
  if (unidadeVendaIds?.length && !retryFromLogId) {
    const approvedSet = new Set(
      (
        await prisma.divisionSubmission.findMany({
          where:  { refMonth: refDate, status: "APPROVED", unidadeVendaId: { in: unidadeVendaIds } },
          select: { unidadeVendaId: true },
        })
      ).map((s) => s.unidadeVendaId)
    );
    const notApproved = unidadeVendaIds.filter((u) => !approvedSet.has(u));
    if (notApproved.length > 0) {
      throw new Error(`Unidade(s) sem aprovação: ${notApproved.join(", ")}`);
    }
  } else if (!retryFromLogId) {
    // Sem filtro de unidade: garante que pelo menos uma está APPROVED
    const approvedCount = await prisma.divisionSubmission.count({
      where: { refMonth: refDate, status: "APPROVED" },
    });
    if (approvedCount === 0) {
      throw new Error(`Nenhuma submissão aprovada para ${refMonth}`);
    }
  }

  // Carrega dados aprovados
  const { items } = await getApprovedForecastData(refMonth);

  // Filtra unidades conforme o modo de operação
  let filteredItems = items;

  if (retryFromLogId) {
    // Retry: processa apenas unidades FAILED/PARTIAL do log anterior
    const parentLog = await prisma.protheusExportLog.findUnique({
      where: { id: retryFromLogId },
    });
    if (parentLog?.details) {
      const details = parentLog.details as unknown as UnitExportDetail[];
      const failedUnits = new Set(
        details
          .filter((d) => d.overallStatus === "FAILED" || d.overallStatus === "PARTIAL")
          .map((d) => d.unidadeVendaId)
      );
      filteredItems = items.filter((i) => failedUnits.has(i.unidadeVendaId));
    }
  } else if (unidadeVendaIds?.length) {
    // Envio seletivo: apenas as unidades explicitamente escolhidas
    const unitSet = new Set(unidadeVendaIds);
    filteredItems = items.filter((i) => unitSet.has(i.unidadeVendaId));
  }

  const totalUnidades = new Set(filteredItems.map((i) => i.unidadeVendaId)).size;

  // Cria ProtheusExportLog
  const log = await prisma.protheusExportLog.create({
    data: {
      refMonth:      refDate,
      triggeredById,
      parentLogId:   retryFromLogId ?? null,
      status:        "RUNNING",
      totalUnidades,
      details:       [],
    },
  });

  // Cria ProtheusExportItems (snapshot auditável dos valores)
  if (filteredItems.length > 0) {
    await prisma.protheusExportItem.createMany({
      data: filteredItems.map((i) => ({
        logId:          log.id,
        unidadeVendaId: i.unidadeVendaId,
        month:          new Date(`${i.month.substring(0, 4)}-${i.month.substring(4, 6)}-01`),
        produtoId:      i.produtoId,
        codigoFamilia:  i.codigoFamilia,
        volumeFCTS:     i.volumeFCTS,
        forecastItemId: i.forecastItemId,
        overrideId:     i.overrideId,
        status:         "PENDING",
      })),
    });
  }

  // Aciona a DAG no Airflow
  try {
    const dagRun = await AirflowService.triggerDag(DAG_ID, { logId: log.id, refMonth });
    // Persiste o dag_run_id para permitir cancelamento via API do Airflow
    await prisma.protheusExportLog.update({
      where: { id: log.id },
      data:  { airflowRunId: dagRun.dag_run_id },
    });
  } catch (err) {
    // Se a DAG falhar ao ser acionada, marcar o log como FAILED imediatamente
    await prisma.protheusExportLog.update({
      where: { id: log.id },
      data:  {
        status:       "FAILED",
        finishedAt:   new Date(),
        errorMessage: `Falha ao acionar DAG Airflow: ${(err as Error).message}`,
      },
    });
    throw err;
  }

  return { logId: log.id };
};

// ── Callbacks da DAG ───────────────────────────────────────────────────────────

export const getExportDataForDag = async (logId: string) => {
  const log = await prisma.protheusExportLog.findUnique({
    where:  { id: logId },
    select: { refMonth: true },
  });
  if (!log) throw new Error(`ProtheusExportLog ${logId} não encontrado`);

  // Busca windowStart e windowEnd do ForecastRun do ciclo
  const run = await prisma.forecastRun.findFirst({
    where:   { refMonth: log.refMonth, status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
    select:  { windowStart: true, windowEnd: true },
  });

  const toYYYYMM = (d: Date | null) =>
    d ? `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}` : null;

  const items = await prisma.protheusExportItem.findMany({
    where:  { logId, status: "PENDING" },
    select: {
      id:             true,
      unidadeVendaId: true,
      month:          true,
      produtoId:      true,
      codigoFamilia:  true,
      volumeFCTS:     true,
    },
    orderBy: [{ unidadeVendaId: "asc" }, { month: "asc" }],
  });

  return {
    // Janela do ciclo para o DELETE
    windowStart: toYYYYMM(run?.windowStart ?? null),
    windowEnd:   toYYYYMM(run?.windowEnd   ?? null),
    // Itens a enviar
    items: items.map((i) => ({
      exportItemId:   i.id,
      unidadeVendaId: i.unidadeVendaId,
      month:          i.month.toISOString().substring(0, 7).replace("-", ""), // "YYYYMM"
      produtoId:      i.produtoId,
      codigoFamilia:  i.codigoFamilia,
      volumeFCTS:     i.volumeFCTS,
    })),
  };
};

export interface ProgressPayload {
  logId:          string;
  unidadeVendaId: string;
  month:          string; // "YYYYMM"
  itemIds:        string[];
  status:         "SUCCESS" | "FAILED";
  error?:         string;
}

export const updateProgress = async (payload: ProgressPayload): Promise<void> => {
  const { logId, unidadeVendaId, month, itemIds, status, error } = payload;

  // Atualiza ProtheusExportItems
  await prisma.protheusExportItem.updateMany({
    where: { id: { in: itemIds } },
    data:  {
      status,
      error:  error ?? null,
      sentAt: status === "SUCCESS" ? new Date() : null,
    },
  });

  // Atualiza o campo details do log
  const log = await prisma.protheusExportLog.findUnique({
    where: { id: logId },
    select: { details: true },
  });
  if (!log) return;

  const details: UnitExportDetail[] = (log.details as unknown as UnitExportDetail[]) ?? [];

  let unitDetail = details.find((d) => d.unidadeVendaId === unidadeVendaId);
  if (!unitDetail) {
    unitDetail = {
      unidadeVendaId,
      deleteStatus:  "PENDING",
      overallStatus: "PENDING",
      meses:         [],
    };
    details.push(unitDetail);
  }

  const existingMes = unitDetail.meses.find((m) => m.month === month);
  if (existingMes) {
    existingMes.status    = status;
    existingMes.itemCount = itemIds.length;
    existingMes.attempt   = (existingMes.attempt ?? 0) + 1;
    existingMes.error     = error;
  } else {
    unitDetail.meses.push({
      month,
      status,
      itemCount: itemIds.length,
      attempt:   1,
      error,
    });
  }

  await prisma.protheusExportLog.update({
    where: { id: logId },
    data:  { details: details as unknown as Prisma.InputJsonValue },
  });
};

export interface DeleteStatusPayload {
  logId:          string;
  unidadeVendaId: string;
  status:         "SUCCESS" | "FAILED";
  error?:         string;
}

export const updateDeleteStatus = async (payload: DeleteStatusPayload): Promise<void> => {
  const { logId, unidadeVendaId, status, error } = payload;

  const log = await prisma.protheusExportLog.findUnique({
    where:  { id: logId },
    select: { details: true },
  });
  if (!log) return;

  const details: UnitExportDetail[] = (log.details as unknown as UnitExportDetail[]) ?? [];
  let unitDetail = details.find((d) => d.unidadeVendaId === unidadeVendaId);
  if (!unitDetail) {
    unitDetail = { unidadeVendaId, deleteStatus: "PENDING", overallStatus: "PENDING", meses: [] };
    details.push(unitDetail);
  }
  unitDetail.deleteStatus = status;
  if (status === "FAILED") {
    unitDetail.overallStatus = "FAILED";
    unitDetail.error = error;
    // Marcar todos os items desta unidade como FAILED
    await prisma.protheusExportItem.updateMany({
      where: { logId, unidadeVendaId, status: "PENDING" },
      data:  { status: "FAILED", error: error ?? "DELETE falhou" },
    });
  }

  await prisma.protheusExportLog.update({ where: { id: logId }, data: { details: details as unknown as Prisma.InputJsonValue } });
};

export interface FinalizePayload {
  logId:           string;
  unidadesOk:      number;
  unidadesFailed:  number;
  details:         UnitExportDetail[];
  startedAt:       string; // ISO
  error?:          string;
}

export const finalizeExport = async (payload: FinalizePayload): Promise<void> => {
  const { logId, unidadesOk, unidadesFailed, details, startedAt, error } = payload;

  const total = unidadesOk + unidadesFailed;
  let finalStatus: "SUCCESS" | "PARTIAL" | "FAILED";
  if (total === 0 || (error && unidadesOk === 0)) {
    // Nenhuma unidade processada (ex: DAG abortou antes de iniciar) — sempre FAILED
    finalStatus = "FAILED";
  } else if (unidadesFailed === 0) {
    finalStatus = "SUCCESS";
  } else if (unidadesOk === 0) {
    finalStatus = "FAILED";
  } else {
    finalStatus = "PARTIAL";
  }

  const now     = new Date();
  const started = new Date(startedAt);
  const durationMs = now.getTime() - started.getTime();

  // Marca itens PENDING remanescentes como FAILED (caso DAG tenha abortado)
  await prisma.protheusExportItem.updateMany({
    where: { logId, status: "PENDING" },
    data:  { status: "FAILED", error: "DAG abortada antes de processar este item" },
  });

  // Gera CSV fallback se necessário
  let csvFallbackPath: string | null = null;
  if (unidadesFailed > 0) {
    csvFallbackPath = await generateCsvFallback(logId);
  }

  const log = await prisma.protheusExportLog.update({
    where: { id: logId },
    data:  {
      status:        finalStatus,
      unidadesOk,
      unidadesFailed,
      totalUnidades:  total,
      finishedAt:    now,
      durationMs,
      details:       details as unknown as Prisma.InputJsonValue,
      errorMessage:  error ?? null,
      csvFallbackPath,
    },
    select: { refMonth: true },
  });

  // Itens efetivamente confirmados no ERP, para o texto da notificação
  const [itensOk, itensFalha] = await Promise.all([
    prisma.protheusExportItem.count({ where: { logId, status: "SUCCESS" } }),
    prisma.protheusExportItem.count({ where: { logId, status: "FAILED"  } }),
  ]);

  const minutos = Math.max(1, Math.round(durationMs / 60_000));
  const resumo =
    finalStatus === "SUCCESS"
      ? `${itensOk} itens de ${unidadesOk} unidade(s) enviados e confirmados no ERP em ${minutos} min.`
      : finalStatus === "PARTIAL"
      ? `${itensOk} itens confirmados no ERP e ${itensFalha} com pendência, em ${unidadesOk + unidadesFailed} unidade(s).`
      : `O envio não foi concluído: ${itensFalha} itens ficaram sem confirmação no ERP.` +
        (error ? ` Motivo: ${error}` : "");

  await notifyExportResult(logId, log.refMonth, finalStatus, resumo);
};

// ── CSV Fallback ───────────────────────────────────────────────────────────────

const generateCsvFallback = async (logId: string): Promise<string | null> => {
  try {
    const items = await prisma.protheusExportItem.findMany({
      where:  { logId, status: "FAILED" },
      select: {
        log:            { select: { refMonth: true } },
        unidadeVendaId: true,
        month:          true,
        produtoId:      true,
        codigoFamilia:  true,
        volumeFCTS:     true,
        error:          true,
      },
    });

    if (items.length === 0) return null;

    const refMonthStr = items[0].log.refMonth.toISOString().substring(0, 7);
    const timestamp   = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const filename    = `protheus_fallback_${refMonthStr}_${timestamp}.csv`;

    const exportsDir = path.resolve(__dirname, "../../exports");
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    const filePath = path.join(exportsDir, filename);
    const header   = "refMonth,unidadeVendaId,month,produtoId,codigoFamilia,volumeFCTS,motivo_falha\n";
    const rows     = items.map((i) =>
      [
        refMonthStr,
        i.unidadeVendaId,
        i.month.toISOString().substring(0, 7),
        i.produtoId,
        i.codigoFamilia ?? "",
        i.volumeFCTS,
        (i.error ?? "").replace(/,/g, ";"),
      ].join(",")
    );

    fs.writeFileSync(filePath, header + rows.join("\n"), "utf-8");
    return `/exports/${filename}`;
  } catch (err) {
    console.error("[protheus-export] Falha ao gerar CSV fallback:", err);
    return null;
  }
};

// ── Consultas de status e histórico ───────────────────────────────────────────

export const getExportStatus = async (refMonth: string) => {
  const refDate = new Date(refMonth);

  const [run, submissionsList, latestLog, latestCycle] = await Promise.all([
    prisma.forecastRun.findFirst({
      where:   { refMonth: refDate, status: "SUCCESS" },
      orderBy: { executedAt: "desc" },
      select:  { id: true, executedAt: true },
    }),

    prisma.divisionSubmission.findMany({
      where:   { refMonth: refDate },
      select:  {
        unidadeVendaId: true,
        status:         true,
        unidadeVenda:   { select: { descricao: true } },
      },
      orderBy: { unidadeVendaId: "asc" },
    }),

    prisma.protheusExportLog.findFirst({
      where:   { refMonth: refDate },
      orderBy: { startedAt: "desc" },
      select: {
        id:              true,
        status:          true,
        startedAt:       true,
        finishedAt:      true,
        totalUnidades:   true,
        unidadesOk:      true,
        unidadesFailed:  true,
        csvFallbackPath: true,
        details:         true,
      },
    }),

    // Ciclo mais recente registrado — define o "ciclo atual" para fins de bloqueio
    prisma.cycleReadinessLog.findFirst({
      orderBy: { refMonth: "desc" },
      select:  { refMonth: true },
    }),
  ]);

  const approvedCount = submissionsList.filter((s: { status: string }) => s.status === "APPROVED").length;
  const openCount     = submissionsList.filter((s: { status: string }) => s.status === "DRAFT" || s.status === "SUBMITTED").length;
  const totalUnidades = submissionsList.length;

  // Ciclo atual = refMonth mais recente no CycleReadinessLog.
  // Ciclos anteriores são bloqueados para envio a fim de evitar sobrescrita acidental.
  const isCurrentCycle = !latestCycle || refDate >= latestCycle.refMonth;

  // Alerta: ForecastRun foi regenerado APÓS o último envio ao Protheus
  const forecastRunUpdatedAfterExport = !!(
    run?.executedAt &&
    latestLog?.startedAt &&
    run.executedAt > latestLog.startedAt
  );

  return {
    refMonth,
    forecastRunExists:            !!run,
    totalUnidades,
    unidadesApproved:             approvedCount,
    unidadesOpen:                 openCount,
    allApproved:                  openCount === 0 && approvedCount > 0,
    submissions:                  submissionsList,
    isCurrentCycle,
    forecastRunUpdatedAfterExport,
    latestExport:                 latestLog ?? null,
  };
};

export const getExportLogs = async (refMonth?: string) => {
  const where = refMonth ? { refMonth: new Date(refMonth) } : {};
  return prisma.protheusExportLog.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take:    50,
    select: {
      id:             true,
      refMonth:       true,
      status:         true,
      startedAt:      true,
      finishedAt:     true,
      totalUnidades:  true,
      unidadesOk:     true,
      unidadesFailed: true,
      durationMs:     true,
      parentLogId:    true,
      csvFallbackPath: true,
      triggeredBy:    { select: { nome: true, email: true } },
    },
  });
};

export const getExportLogDetail = async (logId: string) => {
  const log = await prisma.protheusExportLog.findUnique({
    where: { id: logId },
    include: {
      triggeredBy: { select: { nome: true, email: true } },
      items: {
        orderBy: [{ unidadeVendaId: "asc" }, { month: "asc" }, { produtoId: "asc" }],
        select: {
          id:             true,
          unidadeVendaId: true,
          month:          true,
          produtoId:      true,
          codigoFamilia:  true,
          volumeFCTS:     true,
          status:         true,
          error:          true,
          sentAt:         true,
          forecastItemId: true,
          overrideId:     true,
        },
      },
    },
  });
  return log;
};

// ── Cancelamento manual ───────────────────────────────────────────────────────

export const cancelExport = async (logId: string): Promise<void> => {
  const log = await prisma.protheusExportLog.findUnique({
    where:  { id: logId },
    select: { status: true, airflowRunId: true },
  });
  if (!log) throw Object.assign(new Error("Log não encontrado"), { code: "NOT_FOUND" });
  if (log.status !== "RUNNING") throw Object.assign(new Error("Apenas exports em andamento podem ser cancelados"), { code: "NOT_RUNNING" });

  // 1. Marca o log como FAILED no banco — a DAG vai abortar ao checar o status antes da próxima unidade
  await prisma.protheusExportItem.updateMany({
    where: { logId, status: "PENDING" },
    data:  { status: "FAILED", error: "Cancelado manualmente" },
  });

  await prisma.protheusExportLog.update({
    where: { id: logId },
    data: {
      status:       "FAILED",
      finishedAt:   new Date(),
      errorMessage: "Cancelado manualmente pelo administrador",
    },
  });

  // 2. Tenta encerrar a DAG run no Airflow (best-effort — não falha se o Airflow não responder)
  if (log.airflowRunId) {
    try {
      await AirflowService.cancelDagRun(DAG_ID, log.airflowRunId);
      console.info(`[cancelExport] DAG run ${log.airflowRunId} marcada como failed no Airflow.`);
    } catch (err) {
      // Não propaga — o log já foi marcado como FAILED; a DAG vai abortar pelo dead-man's switch
      console.warn(`[cancelExport] Não foi possível encerrar DAG run ${log.airflowRunId} no Airflow:`, (err as Error).message);
    }
  }
};

// ── Exportação CSV (método alternativo ao Airflow) ────────────────────────────

/**
 * Gera o CSV no formato exato que o Protheus espera no POST /importarprevisaovendas.
 * Colunas: C4_DATA, C4_XCLVL, C4_XTIPO, C4_PRODUTO, C4_QUANT, C4_XFAMAGM
 */
export const generateExportCsv = async (
  refMonth: string,
  unidadeVendaIds?: string[]
): Promise<{ csv: string; filename: string; rowCount: number }> => {
  const { items } = await getApprovedForecastData(refMonth);

  const filtered = unidadeVendaIds?.length
    ? items.filter((i) => unidadeVendaIds.includes(i.unidadeVendaId))
    : items;

  if (filtered.length === 0) {
    throw Object.assign(
      new Error("Nenhum item aprovado encontrado para os parâmetros informados"),
      { code: "EMPTY" }
    );
  }

  const header = "C4_DATA;C4_XCLVL;C4_XTIPO;C4_PRODUTO;C4_QUANT;C4_XFAMAGM";
  const rows = filtered.map((i) => {
    const c4Data = `${i.month.substring(0, 6)}01`; // "YYYYMM" → "YYYYMM01"
    return [
      c4Data,
      i.unidadeVendaId,
      "R",
      i.produtoId,
      i.volumeFCTS,
      i.codigoFamilia ?? "",
    ].join(";");
  });

  const csv      = [header, ...rows].join("\r\n");
  const filename = `protheus_forecast_${refMonth}_${Date.now()}.csv`;

  return { csv, filename, rowCount: rows.length };
};

// ── Dead-man's switch: status atual do log (para a DAG checar antes de cada unidade) ──

export const getLogCurrentStatus = async (logId: string): Promise<string | null> => {
  const log = await prisma.protheusExportLog.findUnique({
    where:  { id: logId },
    select: { status: true },
  });
  return log?.status ?? null;
};

// ── Utilitário: verificar pré-condições sem criar log ─────────────────────────

export const checkPreconditions = async (refMonth: string) => {
  const refDate = new Date(refMonth);

  const [run, openCount, approvedCount, runningLog] = await Promise.all([
    prisma.forecastRun.findFirst({ where: { refMonth: refDate, status: "SUCCESS" } }),
    prisma.divisionSubmission.count({ where: { refMonth: refDate, status: { in: ["DRAFT", "SUBMITTED"] } } }),
    prisma.divisionSubmission.count({ where: { refMonth: refDate, status: "APPROVED" } }),
    prisma.protheusExportLog.findFirst({ where: { refMonth: refDate, status: "RUNNING" } }),
  ]);

  return {
    runExists:    !!run,
    openCount,
    approvedCount,
    allApproved:  openCount === 0 && approvedCount > 0,
    isRunning:    !!runningLog,
    runningLogId: runningLog?.id ?? null,
  };
};
