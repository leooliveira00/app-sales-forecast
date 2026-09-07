import { Response } from "express";
import { OrcamentoStatus } from "@prisma/client";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as OrcamentoService from "../services/orcamento.service.js";
import * as SnapshotService from "../services/snapshot.service.js";
import { appCache } from "../utils/cache.js";

// ── Runs ───────────────────────────────────────────────────────────────────

export const getRuns = async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await OrcamentoService.listRuns());
  } catch {
    res.status(500).json({ error: "Erro ao buscar runs de orçamento" });
  }
};

export const createRun = async (req: AuthRequest, res: Response) => {
  const { ano, aprovadoEm, status, sourceKey } = req.body;
  if (!ano) return res.status(400).json({ error: "ano é obrigatório" });

  if (status && !["APROVADO", "ARQUIVADO"].includes(status)) {
    return res.status(400).json({ error: "status inválido" });
  }

  try {
    const run = await OrcamentoService.createRun({
      ano: Number(ano),
      aprovadoEm,
      status: status as OrcamentoStatus | undefined,
      sourceKey,
    });
    appCache.invalidateConsolidado();
    void SnapshotService.refreshConsolidadoSnapshot(Number(ano))
      .catch(err => console.error("[snapshot] refreshConsolidadoSnapshot failed:", err));
    res.status(201).json(run);
  } catch {
    res.status(400).json({ error: "Erro ao criar run (ano pode já existir)" });
  }
};

// ── Items ──────────────────────────────────────────────────────────────────

export const upsertItems = async (req: AuthRequest, res: Response) => {
  const { ano } = req.params;
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items deve ser um array não vazio" });
  }

  try {
    const created = await OrcamentoService.upsertItems(Number(ano), items);
    appCache.invalidateConsolidado();
    void SnapshotService.refreshConsolidadoSnapshot(Number(ano))
      .catch(err => console.error("[snapshot] refreshConsolidadoSnapshot failed:", err));
    res.status(201).json({ count: created.length });
  } catch {
    res.status(400).json({ error: "Erro ao inserir itens de orçamento" });
  }
};

// ── Consolidado ────────────────────────────────────────────────────────────

export const getConsolidado = async (req: AuthRequest, res: Response) => {
  const { ano, startMonth, endMonth, lightweight } = req.query as {
    ano?: string; startMonth?: string; endMonth?: string; lightweight?: string;
  };

  let start: string;
  let end: string;

  if (startMonth && endMonth) {
    // Novo formato de janela deslizante: ?startMonth=YYYY-MM&endMonth=YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
      return res.status(400).json({ error: "startMonth e endMonth devem ser YYYY-MM" });
    }
    start = startMonth;
    end   = endMonth;
  } else if (ano) {
    // Retrocompatibilidade: ?ano=YYYY → janela do ano completo
    const y = Number(ano);
    if (isNaN(y)) return res.status(400).json({ error: "ano inválido" });
    start = `${y}-01`;
    end   = `${y}-12`;
  } else {
    return res.status(400).json({ error: "Informe ano ou startMonth+endMonth" });
  }

  try {
    const isLightweight = lightweight === 'true';
    const data = await OrcamentoService.getConsolidado(start, end, isLightweight);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Erro ao buscar consolidado de orçamento" });
  }
};

export const getConsolidadoUnidade = async (req: AuthRequest, res: Response) => {
  const { unidadeVendaId, startMonth, endMonth } = req.query as {
    unidadeVendaId?: string; startMonth?: string; endMonth?: string;
  };

  if (!unidadeVendaId || !startMonth || !endMonth) {
    return res.status(400).json({ error: "unidadeVendaId, startMonth e endMonth são obrigatórios" });
  }
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
    return res.status(400).json({ error: "startMonth e endMonth devem ser YYYY-MM" });
  }
  if (req.user!.perfil === "gestor" && !req.user!.unidadeCodigos.includes(unidadeVendaId)) {
    return res.status(403).json({ error: "Acesso negado à unidade solicitada" });
  }

  try {
    const data = await OrcamentoService.getConsolidadoUnidade(unidadeVendaId, startMonth, endMonth);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Erro ao buscar detalhe da unidade" });
  }
};

export const getConsolidadoUnidadePaisDetail = async (req: AuthRequest, res: Response) => {
  const { unidadeVendaId, paisIso3, startMonth, endMonth } = req.query as {
    unidadeVendaId?: string; paisIso3?: string; startMonth?: string; endMonth?: string;
  };

  if (!unidadeVendaId || !paisIso3 || !startMonth || !endMonth) {
    return res.status(400).json({ error: "unidadeVendaId, paisIso3, startMonth e endMonth são obrigatórios" });
  }
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
    return res.status(400).json({ error: "startMonth e endMonth devem ser YYYY-MM" });
  }
  if (req.user!.perfil === "gestor" && !req.user!.unidadeCodigos.includes(unidadeVendaId)) {
    return res.status(403).json({ error: "Acesso negado à unidade solicitada" });
  }

  try {
    const data = await OrcamentoService.getConsolidadoUnidadePaisDetail(
      unidadeVendaId, paisIso3, startMonth, endMonth,
    );
    res.json(data);
  } catch {
    res.status(500).json({ error: "Erro ao buscar detalhe do país" });
  }
};

export const getConsolidadoUnidadePaises = async (req: AuthRequest, res: Response) => {
  const { unidadeVendaId, startMonth, endMonth } = req.query as {
    unidadeVendaId?: string; startMonth?: string; endMonth?: string;
  };

  if (!unidadeVendaId || !startMonth || !endMonth) {
    return res.status(400).json({ error: "unidadeVendaId, startMonth e endMonth são obrigatórios" });
  }
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
    return res.status(400).json({ error: "startMonth e endMonth devem ser YYYY-MM" });
  }
  if (req.user!.perfil === "gestor" && !req.user!.unidadeCodigos.includes(unidadeVendaId)) {
    return res.status(403).json({ error: "Acesso negado à unidade solicitada" });
  }

  try {
    const data = await OrcamentoService.getConsolidadoUnidadePaises(unidadeVendaId, startMonth, endMonth);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Erro ao buscar países da unidade" });
  }
};
