import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as ProtheusSyncService from "../services/protheus-sync.service.js";

// ── Endpoint interno (chamado pelo Airflow) ───────────────────────────────────

export const receiveProdutos = async (req: Request, res: Response) => {
  const { itens, triggeredBy, cTipo } = req.body as {
    itens:       unknown;
    triggeredBy: unknown;
    cTipo:       unknown;
  };

  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: "Campo 'itens' deve ser um array não-vazio." });
  }

  const source = typeof triggeredBy === "string" && triggeredBy.trim()
    ? triggeredBy.trim()
    : "airflow-scheduler";

  const tipo = typeof cTipo === "string" && cTipo.trim() ? cTipo.trim() : "PA";

  try {
    const result = await ProtheusSyncService.upsertProdutos(
      itens as ProtheusSyncService.ProtheusProductItem[],
      source,
      tipo
    );
    return res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro interno no upsert de produtos.";
    return res.status(500).json({ error: message });
  }
};

// ── Endpoints admin (consultados pela UI) ─────────────────────────────────────

export const getLogs = async (req: AuthRequest, res: Response) => {
  const page     = Math.max(1, parseInt(String(req.query.page     ?? "1"),  10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "20"), 10) || 20));

  try {
    const result = await ProtheusSyncService.getLogs(page, pageSize);
    return res.json(result);
  } catch {
    return res.status(500).json({ error: "Erro ao buscar logs de sincronização." });
  }
};

export const getLog = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const log = await ProtheusSyncService.getLogById(id);
    if (!log) return res.status(404).json({ error: "Log não encontrado." });
    return res.json(log);
  } catch {
    return res.status(500).json({ error: "Erro ao buscar log." });
  }
};
