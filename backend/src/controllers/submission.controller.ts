import { Response } from "express";
import { SubmissionStatus } from "@prisma/client";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as SubmissionService from "../services/submission.service.js";
import { assertCycleReady } from "../services/cycle-readiness.service.js";

export const list = async (req: AuthRequest, res: Response) => {
  const { status, unidadeVendaId } = req.query;
  const user = req.user!;

  try {
    const filters: { status?: SubmissionStatus; unidadeVendaId?: string; autorId?: string } = {};

    if (status) filters.status = status as SubmissionStatus;
    if (unidadeVendaId) filters.unidadeVendaId = unidadeVendaId as string;

    // Gestor só vê suas próprias submissões
    if (user.perfil === "gestor") {
      filters.autorId = user.id;
    }

    const submissions = await SubmissionService.list(filters);
    res.json(submissions);
  } catch {
    res.status(500).json({ error: "Erro ao buscar submissões" });
  }
};

export const pendingCount = async (_req: AuthRequest, res: Response) => {
  try {
    const count = await SubmissionService.pendingCount();
    res.json({ count });
  } catch {
    res.status(500).json({ error: "Erro ao contar submissões pendentes" });
  }
};

export const getByUnitAndMonth = async (req: AuthRequest, res: Response) => {
  const { unidadeVendaId, month } = req.query;

  if (!unidadeVendaId || !month) {
    return res.status(400).json({ error: "unidadeVendaId e month são obrigatórios" });
  }

  try {
    const sub = await SubmissionService.findByUnitAndMonth(
      unidadeVendaId as string,
      month as string
    );
    res.json(sub ?? null);
  } catch {
    res.status(500).json({ error: "Erro ao buscar submissão" });
  }
};

export const submit = async (req: AuthRequest, res: Response) => {
  const { unidadeVendaId, refMonth } = req.body;
  const autorId = req.user!.id;

  if (!unidadeVendaId || !refMonth) {
    return res.status(400).json({ error: "unidadeVendaId e refMonth são obrigatórios" });
  }

  // Gate check: block submission if cycle is not READY
  const gateCheck = await assertCycleReady(refMonth);
  if (gateCheck.blocked) {
    return res.status(409).json(gateCheck);
  }

  try {
    // Cria ou obtém o rascunho e submete
    const draft = await SubmissionService.getOrCreate(unidadeVendaId, refMonth, autorId);

    if (draft.status === "APPROVED") {
      return res.status(400).json({ error: "Submissão já está aprovada." });
    }

    const submitted = await SubmissionService.submit(draft.id, autorId);
    res.json(submitted);
  } catch {
    res.status(400).json({ error: "Erro ao submeter forecast" });
  }
};

export const approve = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const revisorId = req.user!.id;

  try {
    const sub = await SubmissionService.approve(id, revisorId);
    res.json(sub);
  } catch {
    res.status(400).json({ error: "Erro ao aprovar submissão" });
  }
};

export const reject = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const revisorId = req.user!.id;

  if (!reason?.trim()) {
    return res.status(400).json({ error: "Motivo da rejeição é obrigatório" });
  }

  try {
    const sub = await SubmissionService.reject(id, revisorId, reason.trim());
    res.json(sub);
  } catch {
    res.status(400).json({ error: "Erro ao rejeitar submissão" });
  }
};

export const getPreview = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const preview = await SubmissionService.getPreview(id);
    if (!preview) return res.status(404).json({ error: "Submissão não encontrada" });
    res.json(preview);
  } catch {
    res.status(500).json({ error: "Erro ao buscar prévia da submissão" });
  }
};
