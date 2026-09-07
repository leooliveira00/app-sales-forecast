import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as CycleService from "../services/cycle-readiness.service.js";

export const list = async (req: AuthRequest, res: Response) => {
  const perfil = req.user!.perfil;
  try {
    const logs = await CycleService.listRecent(6);

    if (perfil === "gestor") {
      // Gestor always gets current calendar month as refMonth, regardless of ForecastRun existence
      const now = new Date();
      const currentRefMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const current = logs[0];
      return res.json({ gate: current?.gate ?? "PENDING", refMonth: currentRefMonth });
    }

    if (perfil === "controladoria") {
      return res.json(
        logs.slice(0, 3).map((l) => ({ gate: l.gate, refMonth: l.refMonth }))
      );
    }

    return res.json(logs);
  } catch {
    res.status(500).json({ error: "Erro ao buscar prontidão dos ciclos" });
  }
};

export const block = async (req: AuthRequest, res: Response) => {
  const { refMonth } = req.params;
  const { reason }   = req.body;
  const userId       = req.user!.id;

  if (!reason?.trim()) {
    return res.status(400).json({ error: "O motivo do bloqueio é obrigatório." });
  }

  try {
    const log = await CycleService.blockCycle(refMonth, userId, reason.trim());
    res.json(log);
  } catch (err) {
    console.error("[cycle block]", err);
    res.status(500).json({ error: "Erro ao bloquear ciclo" });
  }
};

export const overview = async (req: AuthRequest, res: Response) => {
  const past   = Math.min(24, Math.max(1, parseInt(String(req.query.past   ?? "6"),  10) || 6));
  const future = Math.min(6,  Math.max(0, parseInt(String(req.query.future ?? "2"),  10) || 2));
  try {
    const data = await CycleService.getOverview(past, future);
    res.json(data);
  } catch (err) {
    console.error("[cycle overview]", err);
    res.status(500).json({ error: "Erro ao montar visão geral dos ciclos" });
  }
};

export const close = async (req: AuthRequest, res: Response) => {
  const { refMonth } = req.params;
  const { reason }   = req.body;
  const userId       = req.user!.id;

  if (!reason?.trim()) {
    return res.status(400).json({ error: "O motivo do encerramento é obrigatório." });
  }

  try {
    await CycleService.closeCycle(refMonth, userId, reason.trim());
    res.json({ ok: true });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "SUBMITTED_OPEN") {
      return res.status(409).json({ error: (err as Error).message });
    }
    console.error("[cycle close]", err);
    res.status(500).json({ error: "Erro ao encerrar ciclo" });
  }
};

export const unblock = async (req: AuthRequest, res: Response) => {
  const { refMonth } = req.params;
  const { note }     = req.body;
  const userId       = req.user!.id;

  try {
    const log = await CycleService.unblockCycle(refMonth, userId, note?.trim());
    res.json(log);
  } catch (err) {
    console.error("[cycle unblock]", err);
    res.status(500).json({ error: "Erro ao desbloquear ciclo" });
  }
};

export const rerun = async (req: AuthRequest, res: Response) => {
  const { refMonth }   = req.params;
  const { dags, reason } = req.body;
  const userId          = req.user!.id;

  if (!Array.isArray(dags) || dags.length === 0) {
    return res.status(400).json({ error: "Selecione ao menos uma DAG para re-executar." });
  }
  if (!reason?.trim()) {
    return res.status(400).json({ error: "O motivo da re-execução é obrigatório." });
  }

  try {
    const log = await CycleService.rerunCycle(refMonth, userId, dags, reason.trim());
    res.json(log);
  } catch (err) {
    console.error("[cycle rerun]", err);
    res.status(500).json({ error: "Erro ao re-executar DAGs do ciclo" });
  }
};
