import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as ProtheusExportService from "../services/protheus-export.service.js";

// ── Rotas Admin ────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/protheus/export
 * Cria o log, snapshot dos itens e aciona a DAG no Airflow.
 * Restrito a admin_ti.
 */
export const triggerExport = async (req: AuthRequest, res: Response) => {
  const { refMonth, unidadeVendaIds } = req.body as {
    refMonth?:       string;
    unidadeVendaIds?: string[];
  };
  if (!refMonth) return res.status(400).json({ error: "refMonth é obrigatório (ex: '2026-07')" });

  try {
    const result = await ProtheusExportService.triggerExport(refMonth, req.user!.id, {
      unidadeVendaIds: unidadeVendaIds?.length ? unidadeVendaIds : undefined,
    });
    return res.status(202).json(result);
  } catch (err) {
    const msg = (err as Error).message;
    if (
      msg.includes("em andamento") ||
      msg.includes("sem aprovação") ||
      msg.includes("Nenhuma submissão") ||
      msg.includes("SUCCESS não encontrado")
    ) {
      return res.status(422).json({ error: msg });
    }
    console.error("[protheus-export] triggerExport:", err);
    return res.status(500).json({ error: "Erro interno ao iniciar exportação" });
  }
};

/**
 * POST /api/admin/protheus/export/:logId/retry-failed
 * Cria novo log com parentLogId, processa apenas unidades FAILED/PARTIAL do log anterior.
 */
export const retryFailed = async (req: AuthRequest, res: Response) => {
  const { logId } = req.params;
  const { refMonth } = req.body as { refMonth?: string };
  if (!refMonth) return res.status(400).json({ error: "refMonth é obrigatório" });

  try {
    const result = await ProtheusExportService.triggerExport(refMonth, req.user!.id, { retryFromLogId: logId });
    return res.status(202).json(result);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("em andamento") || msg.includes("em aberto") || msg.includes("SUCCESS não encontrado")) {
      return res.status(422).json({ error: msg });
    }
    console.error("[protheus-export] retryFailed:", err);
    return res.status(500).json({ error: "Erro interno ao iniciar reprocessamento" });
  }
};

/**
 * GET /api/admin/protheus/export/status/:refMonth
 * Retorna pré-condições + log mais recente (usado para polling pelo frontend).
 */
export const checkStatus = async (req: Request, res: Response) => {
  const { refMonth } = req.params;
  try {
    const status = await ProtheusExportService.getExportStatus(refMonth);
    return res.json(status);
  } catch (err) {
    console.error("[protheus-export] checkStatus:", err);
    return res.status(500).json({ error: "Erro ao verificar status" });
  }
};

/**
 * GET /api/admin/protheus/export/logs?refMonth=YYYY-MM
 */
export const listLogs = async (req: Request, res: Response) => {
  const refMonth = req.query.refMonth as string | undefined;
  try {
    const logs = await ProtheusExportService.getExportLogs(refMonth);
    return res.json(logs);
  } catch (err) {
    console.error("[protheus-export] listLogs:", err);
    return res.status(500).json({ error: "Erro ao listar logs" });
  }
};

/**
 * GET /api/admin/protheus/export/logs/:id
 * Detalhe completo do log + itens enviados (para auditoria).
 */
export const getLogDetail = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const log = await ProtheusExportService.getExportLogDetail(id);
    if (!log) return res.status(404).json({ error: "Log não encontrado" });
    return res.json(log);
  } catch (err) {
    console.error("[protheus-export] getLogDetail:", err);
    return res.status(500).json({ error: "Erro ao buscar log" });
  }
};

/**
 * GET /api/admin/protheus/export/csv?refMonth=YYYY-MM&unidadeVendaIds=UV1,UV2
 * Gera e devolve o CSV no formato Protheus para importação manual.
 */
export const downloadCsv = async (req: Request, res: Response) => {
  const refMonth        = req.query.refMonth as string | undefined;
  const unidadeVendaIds = req.query.unidadeVendaIds
    ? (req.query.unidadeVendaIds as string).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  if (!refMonth) return res.status(400).json({ error: "refMonth é obrigatório (ex: '2026-07')" });

  try {
    const { csv, filename, rowCount } = await ProtheusExportService.generateExportCsv(refMonth, unidadeVendaIds);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Row-Count", String(rowCount));
    return res.send("\uFEFF" + csv); // BOM UTF-8 para Excel abrir corretamente
  } catch (err) {
    const msg  = (err as Error & { code?: string }).message;
    const code = (err as Error & { code?: string }).code;
    if (code === "EMPTY") return res.status(422).json({ error: msg });
    console.error("[protheus-export] downloadCsv:", err);
    return res.status(500).json({ error: "Erro ao gerar CSV" });
  }
};

/**
 * POST /api/admin/protheus/export/:logId/cancel
 * Força um export RUNNING para FAILED (uso emergencial quando a DAG trava).
 */
export const cancelExport = async (req: AuthRequest, res: Response) => {
  const { logId } = req.params;
  try {
    await ProtheusExportService.cancelExport(logId);
    return res.json({ ok: true });
  } catch (err) {
    const msg = (err as Error & { code?: string }).message;
    const code = (err as Error & { code?: string }).code;
    if (code === "NOT_FOUND")    return res.status(404).json({ error: msg });
    if (code === "NOT_RUNNING")  return res.status(422).json({ error: msg });
    console.error("[protheus-export] cancelExport:", err);
    return res.status(500).json({ error: "Erro ao cancelar export" });
  }
};

// ── Rotas Internas (para a DAG Airflow) ───────────────────────────────────────

/**
 * GET /api/internal/protheus-export/log-status?logId=...
 * Dead-man's switch: a DAG consulta antes de cada unidade para saber se o export foi cancelado.
 */
export const getLogStatus = async (req: Request, res: Response) => {
  const { logId } = req.query;
  if (!logId) return res.status(400).json({ error: "logId é obrigatório" });

  try {
    const status = await ProtheusExportService.getLogCurrentStatus(logId as string);
    if (status === null) return res.status(404).json({ error: "Log não encontrado" });
    return res.json({ status });
  } catch (err) {
    console.error("[protheus-export] getLogStatus:", err);
    return res.status(500).json({ error: "Erro ao verificar status do log" });
  }
};

/**
 * GET /api/internal/protheus-export/data?logId=...
 * Retorna os ProtheusExportItems PENDING para a DAG processar.
 */
export const getExportData = async (req: Request, res: Response) => {
  const { logId } = req.query;
  if (!logId) return res.status(400).json({ error: "logId é obrigatório" });

  try {
    const data = await ProtheusExportService.getExportDataForDag(logId as string);
    return res.json(data);
  } catch (err) {
    console.error("[protheus-export] getExportData:", err);
    return res.status(500).json({ error: "Erro ao buscar dados de export" });
  }
};

/**
 * POST /api/internal/protheus-export/delete-status
 * DAG reporta o resultado do DELETE por unidade.
 */
export const reportDeleteStatus = async (req: Request, res: Response) => {
  const payload = req.body as ProtheusExportService.DeleteStatusPayload;
  if (!payload?.logId || !payload?.unidadeVendaId || !payload?.status) {
    return res.status(400).json({ error: "logId, unidadeVendaId e status são obrigatórios" });
  }
  try {
    await ProtheusExportService.updateDeleteStatus(payload);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[protheus-export] reportDeleteStatus:", err);
    return res.status(500).json({ error: "Erro ao atualizar status de delete" });
  }
};

/**
 * POST /api/internal/protheus-export/progress
 * DAG reporta progresso por mês×unidade após cada POST ao Protheus.
 */
export const reportProgress = async (req: Request, res: Response) => {
  const payload = req.body as ProtheusExportService.ProgressPayload;
  if (!payload?.logId || !payload?.unidadeVendaId || !payload?.month || !payload?.itemIds || !payload?.status) {
    return res.status(400).json({ error: "Campos obrigatórios: logId, unidadeVendaId, month, itemIds, status" });
  }
  try {
    await ProtheusExportService.updateProgress(payload);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[protheus-export] reportProgress:", err);
    return res.status(500).json({ error: "Erro ao atualizar progresso" });
  }
};

/**
 * POST /api/internal/protheus-export/finalize
 * DAG reporta conclusão da execução (status final).
 */
export const finalize = async (req: Request, res: Response) => {
  const payload = req.body as ProtheusExportService.FinalizePayload;
  if (!payload?.logId) {
    return res.status(400).json({ error: "logId é obrigatório" });
  }
  try {
    await ProtheusExportService.finalizeExport(payload);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[protheus-export] finalize:", err);
    return res.status(500).json({ error: "Erro ao finalizar export" });
  }
};
