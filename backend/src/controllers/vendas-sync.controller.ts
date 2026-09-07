import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as VendasSyncService from "../services/vendas-sync.service.js";

// ── Endpoint interno (chamado pelo Airflow) ───────────────────────────────────

export const receiveVendas = async (req: Request, res: Response) => {
  const { itens, refMonth, cDataDe, cDataAte, triggeredBy } = req.body as {
    itens:       unknown;
    refMonth:    unknown;
    cDataDe:     unknown;
    cDataAte:    unknown;
    triggeredBy: unknown;
  };

  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: "Campo 'itens' deve ser um array não-vazio." });
  }

  if (typeof refMonth !== "string" || !refMonth.trim()) {
    return res.status(400).json({ error: "Campo 'refMonth' é obrigatório (ex: '2026-02-01')." });
  }

  if (typeof cDataDe !== "string" || !cDataDe.trim()) {
    return res.status(400).json({ error: "Campo 'cDataDe' é obrigatório." });
  }

  if (typeof cDataAte !== "string" || !cDataAte.trim()) {
    return res.status(400).json({ error: "Campo 'cDataAte' é obrigatório." });
  }

  const source = typeof triggeredBy === "string" && triggeredBy.trim()
    ? triggeredBy.trim()
    : "airflow-scheduler";

  try {
    const result = await VendasSyncService.syncVendas(
      itens as VendasSyncService.VendaAgregadaItem[],
      refMonth.trim(),
      cDataDe.trim(),
      cDataAte.trim(),
      source,
    );
    return res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro interno no sync de vendas.";
    return res.status(500).json({ error: message });
  }
};

// ── Endpoints admin (consultados pela UI) ─────────────────────────────────────

export const getLogs = async (req: AuthRequest, res: Response) => {
  const page     = Math.max(1, parseInt(String(req.query.page     ?? "1"),  10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "20"), 10) || 20));

  try {
    const result = await VendasSyncService.getLogs(page, pageSize);
    return res.json(result);
  } catch {
    return res.status(500).json({ error: "Erro ao buscar logs de sincronização de vendas." });
  }
};

export const getLog = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const log = await VendasSyncService.getLogById(id);
    if (!log) return res.status(404).json({ error: "Log não encontrado." });
    return res.json(log);
  } catch {
    return res.status(500).json({ error: "Erro ao buscar log." });
  }
};
