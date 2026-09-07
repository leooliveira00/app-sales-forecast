import { Response } from "express";
import { RunStatus } from "@prisma/client";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as ForecastService from "../services/forecast.service.js";
import * as SnapshotService from "../services/snapshot.service.js";
import { assertCycleReady } from "../services/cycle-readiness.service.js";
import prisma from "../config/prisma.js";

// ── Helper: ciclo aprovado? ────────────────────────────────────────────────
/**
 * Retorna true se a DivisionSubmission de (refMonth, unidade) está APPROVED.
 * Usado para decidir se vale recomputar snapshots após mutações de override —
 * snapshots só consomem dados de ciclos aprovados (ver snapshot.service.ts e
 * forecast.service.ts:getAcuraciaUnidades), então em DRAFT/SUBMITTED o refresh
 * recalcularia os mesmos valores, gastando CPU e conexões à toa.
 */
async function isCycleApproved(
  refMonth: Date,
  unidadeVendaId: string
): Promise<boolean> {
  const sub = await prisma.divisionSubmission.findUnique({
    where:  { refMonth_unidadeVendaId: { refMonth, unidadeVendaId } },
    select: { status: true },
  });
  return sub?.status === "APPROVED";
}

// ── Helper: bloqueia alterações de portfólio após submissão ────────────────
/**
 * Retorna true (e responde 409) se a submissão activa da unidade para o ciclo
 * do run já estiver em status SUBMITTED ou APPROVED.
 * Deve ser chamada no início dos handlers que modificam o portfólio do run.
 */
async function isPortfolioLocked(
  res: Response,
  runId: string,
  unidadeVendaId: string
): Promise<boolean> {
  const run = await prisma.forecastRun.findUnique({
    where: { id: runId },
    select: { refMonth: true },
  });
  if (!run) {
    res.status(404).json({ error: "Run não encontrado" });
    return true;
  }

  const submission = await prisma.divisionSubmission.findUnique({
    where: {
      refMonth_unidadeVendaId: {
        refMonth:      run.refMonth,
        unidadeVendaId,
      },
    },
    select: { status: true },
  });

  if (submission && ["SUBMITTED", "APPROVED"].includes(submission.status)) {
    res.status(409).json({
      error: "Não é permitido alterar o portfólio após a submissão do forecast.",
    });
    return true;
  }

  return false;
}

// ── Runs ───────────────────────────────────────────────────────────────────

export const getNextRelease = async (_req: AuthRequest, res: Response) => {
  try {
    const now           = new Date();
    const SENTINEL_FLOOR = new Date("9000-01-01");
    const run = await prisma.forecastRun.findFirst({
      where: {
        status:        "SUCCESS",
        availableFrom: { gt: now, lt: SENTINEL_FLOOR },
      },
      orderBy: { refMonth: "asc" },
      select:  { availableFrom: true, refMonth: true },
    });
    res.json({ availableFrom: run?.availableFrom?.toISOString() ?? null });
  } catch {
    res.status(500).json({ error: "Erro ao buscar próximo ciclo" });
  }
};

export const getRuns = async (req: AuthRequest, res: Response) => {
  const { month } = req.query;
  try {
    const runs = await ForecastService.listRuns({
      refMonth:       month as string | undefined,
      perfil:         req.user!.perfil,
      unidadeCodigos: req.user!.unidadeCodigos,
    });
    res.json(runs);
  } catch {
    res.status(500).json({ error: "Erro ao buscar runs de forecast" });
  }
};

export const createRun = async (req: AuthRequest, res: Response) => {
  const { refMonth, status, sourceKey, artifactPath, windowStart, windowEnd, leadTimeMonths } = req.body;

  if (!refMonth || !status) {
    return res.status(400).json({ error: "refMonth e status são obrigatórios" });
  }
  if (!["SUCCESS", "FAILED"].includes(status)) {
    return res.status(400).json({ error: "status deve ser SUCCESS ou FAILED" });
  }

  try {
    const run = await ForecastService.createRun({
      refMonth,
      status:         status as RunStatus,
      windowStart,
      windowEnd,
      leadTimeMonths: leadTimeMonths ? Number(leadTimeMonths) : undefined,
      sourceKey,
      artifactPath,
    });
    const ano = new Date(run.refMonth).getUTCFullYear();
    void SnapshotService.refreshConsolidadoSnapshot(ano)
      .catch(err => console.error("[snapshot] refreshConsolidadoSnapshot failed:", err));
    void SnapshotService.refreshAcuraciaSnapshot()
      .catch(err => console.error("[snapshot] refreshAcuraciaSnapshot failed:", err));
    res.status(201).json(run);
  } catch {
    res.status(400).json({ error: "Erro ao criar run" });
  }
};

export const addItemsToRun = async (req: AuthRequest, res: Response) => {
  const { runId } = req.params;
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items deve ser um array não vazio" });
  }

  try {
    const created = await ForecastService.createItems(runId, items);
    // Deriva o ano a partir do refMonth do run para o snapshot
    const runRecord = await prisma.forecastRun.findUnique({ where: { id: runId }, select: { refMonth: true } });
    if (runRecord) {
      const ano = new Date(runRecord.refMonth).getUTCFullYear();
      void SnapshotService.refreshConsolidadoSnapshot(ano)
        .catch(err => console.error("[snapshot] refreshConsolidadoSnapshot failed:", err));
    }
    res.status(201).json({ count: created.length });
  } catch {
    res.status(400).json({ error: "Erro ao inserir itens no run" });
  }
};

export const getAllRuns = async (_req: AuthRequest, res: Response) => {
  try {
    const runs = await ForecastService.listAllRuns();
    res.json(runs);
  } catch {
    res.status(500).json({ error: "Erro ao buscar runs" });
  }
};

export const updateRunAvailability = async (req: AuthRequest, res: Response) => {
  const { runId } = req.params;
  const { availableFrom } = req.body;

  // availableFrom pode ser null (limpar override) ou uma string ISO de data válida
  let parsedDate: Date | null = null;
  if (availableFrom !== null && availableFrom !== undefined) {
    parsedDate = new Date(availableFrom);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: "availableFrom deve ser uma data ISO válida ou null" });
    }
  }

  try {
    const run = await ForecastService.updateRunAvailability(runId, parsedDate);
    res.json(run);
  } catch {
    res.status(400).json({ error: "Erro ao atualizar disponibilidade do ciclo" });
  }
};

// ── Items ──────────────────────────────────────────────────────────────────

export const getItems = async (req: AuthRequest, res: Response) => {
  // Suporta tanto o modelo antigo (?month=) quanto o novo (?refMonth=&targetMonth=)
  const { unidadeVendaId, month, refMonth, targetMonth, runId } = req.query;
  const cycleMonth = (refMonth as string | undefined) ?? (month as string | undefined);

  if (!unidadeVendaId || !cycleMonth) {
    return res.status(400).json({ error: "unidadeVendaId e refMonth (ou month) são obrigatórios" });
  }

  // Gestor só pode ver suas próprias unidades
  if (req.user!.perfil === "gestor") {
    if (!req.user!.unidadeCodigos.includes(unidadeVendaId as string)) {
      return res.status(403).json({ error: "Acesso negado à unidade solicitada" });
    }
  }

  try {
    const result = await ForecastService.getItemsForUnit(
      unidadeVendaId as string,
      cycleMonth,
      runId as string | undefined,
      targetMonth as string | undefined
    );
    res.json(result);
  } catch {
    res.status(500).json({ error: "Erro ao buscar itens de forecast" });
  }
};

// ── Visão Anual ────────────────────────────────────────────────────────────

export const getAnnualItems = async (req: AuthRequest, res: Response) => {
  const { unidadeVendaId, refMonth, paisIso3 } = req.query;

  if (!unidadeVendaId || !refMonth) {
    return res.status(400).json({ error: "unidadeVendaId e refMonth são obrigatórios" });
  }

  if (req.user!.perfil === "gestor") {
    if (!req.user!.unidadeCodigos.includes(unidadeVendaId as string)) {
      return res.status(403).json({ error: "Acesso negado à unidade solicitada" });
    }
  }

  try {
    const result = await ForecastService.getForecastItemsAnnual(
      unidadeVendaId as string,
      refMonth as string,
      typeof paisIso3 === "string" ? paisIso3 : undefined
    );
    res.json(result);
  } catch {
    res.status(500).json({ error: "Erro ao buscar itens anuais de forecast" });
  }
};

// ── Gestão de portfólio por ciclo ─────────────────────────────────────────

export const excludeProductFromRun = async (req: AuthRequest, res: Response) => {
  const { runId, produtoId } = req.params;
  const { unidadeVendaId, paisIso3 } = req.body;
  const gestorId             = req.user!.id;

  if (!unidadeVendaId) {
    return res.status(400).json({ error: "unidadeVendaId é obrigatório" });
  }

  // Gestor só pode operar nas suas próprias unidades
  if (req.user!.perfil === "gestor" && !req.user!.unidadeCodigos.includes(unidadeVendaId)) {
    return res.status(403).json({ error: "Acesso negado" });
  }

  if (await isPortfolioLocked(res, runId, unidadeVendaId)) return;

  try {
    // paisIso3 string = exclui apenas esse país; undefined = exclui todos os países
    const result = await ForecastService.excludeProduct(
      runId, produtoId, unidadeVendaId, gestorId,
      typeof paisIso3 === "string" ? paisIso3 : undefined,
    );
    const runRec = await prisma.forecastRun.findUnique({ where: { id: runId }, select: { refMonth: true } });
    if (runRec) {
      void SnapshotService.refreshConsolidadoSnapshot(
        new Date(runRec.refMonth).getUTCFullYear(),
        { affectedUnits: [unidadeVendaId] }
      ).catch(err => console.error("[snapshot] refreshConsolidadoSnapshot failed:", err));
    }
    res.json({ count: result.count });
  } catch {
    res.status(400).json({ error: "Erro ao excluir produto do ciclo" });
  }
};

export const restoreProductInRun = async (req: AuthRequest, res: Response) => {
  const { runId, produtoId } = req.params;
  const { unidadeVendaId, paisIso3 } = req.body;

  if (!unidadeVendaId) {
    return res.status(400).json({ error: "unidadeVendaId é obrigatório" });
  }

  if (req.user!.perfil === "gestor" && !req.user!.unidadeCodigos.includes(unidadeVendaId)) {
    return res.status(403).json({ error: "Acesso negado" });
  }

  if (await isPortfolioLocked(res, runId, unidadeVendaId)) return;

  try {
    // paisIso3 string = restaura apenas esse país; undefined = restaura todos os países
    const result = await ForecastService.restoreProduct(
      runId, produtoId, unidadeVendaId,
      req.user!.id,
      typeof paisIso3 === "string" ? paisIso3 : undefined,
    );
    const runRec = await prisma.forecastRun.findUnique({ where: { id: runId }, select: { refMonth: true } });
    if (runRec) {
      void SnapshotService.refreshConsolidadoSnapshot(
        new Date(runRec.refMonth).getUTCFullYear(),
        { affectedUnits: [unidadeVendaId] }
      ).catch(err => console.error("[snapshot] refreshConsolidadoSnapshot failed:", err));
    }
    res.json({ count: result.count });
  } catch {
    res.status(400).json({ error: "Erro ao restaurar produto no ciclo" });
  }
};

export const addManualProductToRun = async (req: AuthRequest, res: Response) => {
  const { runId }                          = req.params;
  const { produtoId, unidadeVendaId, paisIso3 } = req.body;
  const gestorId                           = req.user!.id;

  if (!produtoId || !unidadeVendaId) {
    return res.status(400).json({ error: "produtoId e unidadeVendaId são obrigatórios" });
  }

  if (req.user!.perfil === "gestor" && !req.user!.unidadeCodigos.includes(unidadeVendaId)) {
    return res.status(403).json({ error: "Acesso negado" });
  }

  if (await isPortfolioLocked(res, runId, unidadeVendaId)) return;

  try {
    await ForecastService.addManualProduct(
      runId, produtoId, unidadeVendaId, gestorId,
      typeof paisIso3 === "string" ? paisIso3 : null,
    );
    const runRec = await prisma.forecastRun.findUnique({ where: { id: runId }, select: { refMonth: true } });
    if (runRec) {
      void SnapshotService.refreshConsolidadoSnapshot(
        new Date(runRec.refMonth).getUTCFullYear(),
        { affectedUnits: [unidadeVendaId] }
      ).catch(err => console.error("[snapshot] refreshConsolidadoSnapshot failed:", err));
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao adicionar produto ao ciclo";
    res.status(400).json({ error: msg });
  }
};

// ── Overrides ──────────────────────────────────────────────────────────────

export const upsertOverride = async (req: AuthRequest, res: Response) => {
  const { forecastItemId, volumeFCTS, note } = req.body;
  const gestorId = req.user!.id;

  if (!forecastItemId || volumeFCTS === undefined) {
    return res.status(400).json({ error: "forecastItemId e volumeFCTS são obrigatórios" });
  }

  try {
    const fItem = await prisma.forecastItem.findUnique({
      where:  { id: forecastItemId },
      select: { run: { select: { refMonth: true } } },
    });
    if (fItem?.run.refMonth) {
      const gate = await assertCycleReady(fItem.run.refMonth);
      if (gate.blocked) return res.status(409).json(gate);
    }

    const { auditContext } = req.body;
    const override = await ForecastService.upsertOverride(
      forecastItemId,
      gestorId,
      Number(volumeFCTS),
      note,
      auditContext ?? undefined,
    );
    void (async () => {
      try {
        const item = await prisma.forecastItem.findUnique({
          where:  { id: forecastItemId },
          select: { month: true, unidadeVendaId: true, run: { select: { refMonth: true } } },
        });
        if (!item) return;
        if (!(await isCycleApproved(item.run.refMonth, item.unidadeVendaId))) return;
        await SnapshotService.refreshConsolidadoSnapshot(
          new Date(item.month).getUTCFullYear(),
          { affectedUnits: [item.unidadeVendaId] }
        );
        await SnapshotService.refreshAcuraciaSnapshot({ affectedUnits: [item.unidadeVendaId] });
      } catch (err) { console.error("[snapshot] upsertOverride refresh failed:", err); }
    })();
    res.json(override);
  } catch {
    res.status(400).json({ error: "Erro ao salvar override" });
  }
};

export const bulkUpsertOverride = async (req: AuthRequest, res: Response) => {
  const { items } = req.body;
  const gestorId = req.user!.id;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items deve ser um array não vazio" });
  }

  const valid = items.every(
    (i: unknown) =>
      i !== null &&
      typeof i === "object" &&
      "forecastItemId" in (i as object) &&
      "volumeFCTS" in (i as object)
  );
  if (!valid) {
    return res.status(400).json({ error: "Cada item deve ter forecastItemId e volumeFCTS" });
  }

  try {
    const firstItemId = items[0]?.forecastItemId;
    if (firstItemId) {
      const fItem = await prisma.forecastItem.findUnique({
        where:  { id: firstItemId },
        select: { run: { select: { refMonth: true } } },
      });
      if (fItem?.run.refMonth) {
        const gate = await assertCycleReady(fItem.run.refMonth);
        if (gate.blocked) return res.status(409).json(gate);
      }
    }

    const { auditContext } = req.body;
    const overrides = await ForecastService.upsertOverrideBulk(
      items.map((i: { forecastItemId: string; volumeFCTS: number; note?: string }) => ({
        forecastItemId: i.forecastItemId,
        volumeFCTS: Number(i.volumeFCTS),
        note: i.note,
      })),
      gestorId,
      auditContext ?? undefined,
    );
    const forecastItemIds = items.map((i: { forecastItemId: string }) => i.forecastItemId);
    void (async () => {
      try {
        const fItems = await prisma.forecastItem.findMany({
          where:  { id: { in: forecastItemIds } },
          select: { month: true, unidadeVendaId: true, run: { select: { refMonth: true } } },
        });
        const pairs = [...new Map(
          fItems.map(f => [`${f.run.refMonth.toISOString()}|${f.unidadeVendaId}`, { refMonth: f.run.refMonth, unidadeVendaId: f.unidadeVendaId }])
        ).values()];
        const approvedFlags = await Promise.all(
          pairs.map(p => isCycleApproved(p.refMonth, p.unidadeVendaId))
        );
        const approvedUnits = new Set(
          pairs.filter((_, i) => approvedFlags[i]).map(p => p.unidadeVendaId)
        );
        if (approvedUnits.size === 0) return;
        const approvedItems = fItems.filter(f => approvedUnits.has(f.unidadeVendaId));
        const years = [...new Set(approvedItems.map(f => new Date(f.month).getUTCFullYear()))];
        const units = [...approvedUnits];
        for (const ano of years) {
          await SnapshotService.refreshConsolidadoSnapshot(ano, { affectedUnits: units });
        }
        await SnapshotService.refreshAcuraciaSnapshot({ affectedUnits: units });
      } catch (err) { console.error("[snapshot] bulk override refresh failed:", err); }
    })();
    res.json({ count: overrides.count });
  } catch (err) {
    console.error("[bulkUpsertOverride] erro:", err);
    res.status(400).json({ error: "Erro ao salvar overrides em lote" });
  }
};

export const deleteOverride = async (req: AuthRequest, res: Response) => {
  const { forecastItemId } = req.params;

  try {
    await ForecastService.deleteOverride(forecastItemId, req.user!.id);
    void (async () => {
      try {
        const item = await prisma.forecastItem.findUnique({
          where:  { id: forecastItemId },
          select: { month: true, unidadeVendaId: true, run: { select: { refMonth: true } } },
        });
        if (!item) return;
        if (!(await isCycleApproved(item.run.refMonth, item.unidadeVendaId))) return;
        await SnapshotService.refreshConsolidadoSnapshot(
          new Date(item.month).getUTCFullYear(),
          { affectedUnits: [item.unidadeVendaId] }
        );
        await SnapshotService.refreshAcuraciaSnapshot({ affectedUnits: [item.unidadeVendaId] });
      } catch (err) { console.error("[snapshot] deleteOverride refresh failed:", err); }
    })();
    res.status(204).send();
  } catch {
    res.status(400).json({ error: "Erro ao remover override" });
  }
};

// ── Tendência da unidade (últimos 12 meses: ORC × FCTS × Vendas) ──────────

export const getUnitTendencia = async (req: AuthRequest, res: Response) => {
  const { unidadeVendaId, meses, paisIso3 } = req.query;

  if (!unidadeVendaId) {
    return res.status(400).json({ error: "unidadeVendaId é obrigatório" });
  }

  // Gestor só pode consultar suas próprias unidades
  if (req.user!.perfil === "gestor") {
    if (!req.user!.unidadeCodigos.includes(unidadeVendaId as string)) {
      return res.status(403).json({ error: "Acesso negado à unidade solicitada" });
    }
  }

  try {
    const data = await ForecastService.getUnitTendencia(
      unidadeVendaId as string,
      meses ? Number(meses) : 12,
      typeof paisIso3 === "string" ? paisIso3 : undefined,
    );
    res.json(data);
  } catch {
    res.status(500).json({ error: "Erro ao buscar tendência da unidade" });
  }
};

// ── Desvios Críticos ───────────────────────────────────────────────────────

export const getDesviosCriticos = async (req: AuthRequest, res: Response) => {
  const { unidadeVendaId, month, threshold } = req.query;

  if (!unidadeVendaId || !month) {
    return res.status(400).json({ error: "unidadeVendaId e month são obrigatórios" });
  }

  if (req.user!.perfil === "gestor") {
    if (!req.user!.unidadeCodigos.includes(unidadeVendaId as string)) {
      return res.status(403).json({ error: "Acesso negado à unidade solicitada" });
    }
  }

  try {
    const data = await ForecastService.getDesviosCriticos(
      unidadeVendaId as string,
      month as string,
      threshold ? Number(threshold) : 20
    );
    res.json(data);
  } catch {
    res.status(500).json({ error: "Erro ao buscar desvios críticos" });
  }
};

// ── Dashboard summary ──────────────────────────────────────────────────────

export const getDashboardSummary = async (req: AuthRequest, res: Response) => {
  const { month } = req.query;

  if (!month) {
    return res.status(400).json({ error: "month é obrigatório" });
  }

  // Gestor vê apenas suas unidades
  const unidadeVendaIds =
    req.user!.perfil === "gestor" ? req.user!.unidadeCodigos : undefined;

  try {
    const summary = await ForecastService.getDashboardSummary(
      month as string,
      unidadeVendaIds
    );
    res.json(summary);
  } catch {
    res.status(500).json({ error: "Erro ao buscar resumo do dashboard" });
  }
};

// ── Produtos pendentes (detalhe do card "Produtos Preenchidos") ────────────

export const getPendingItems = async (req: AuthRequest, res: Response) => {
  const { month } = req.query;

  if (!month) {
    return res.status(400).json({ error: "month é obrigatório" });
  }

  // Gestor vê apenas suas unidades
  const unidadeVendaIds =
    req.user!.perfil === "gestor" ? req.user!.unidadeCodigos : undefined;

  try {
    const data = await ForecastService.getPendingFilledItems(
      month as string,
      unidadeVendaIds
    );
    res.json(data);
  } catch {
    res.status(500).json({ error: "Erro ao buscar produtos pendentes" });
  }
};

// ── Acurácia por Unidade ───────────────────────────────────────────────────

export const getAcuraciaUnidades = async (req: AuthRequest, res: Response) => {
  const { meses, anchorMonth, startMonth } = req.query as { meses?: string; anchorMonth?: string; startMonth?: string };
  try {
    const data = await ForecastService.getAcuraciaUnidades(
      meses ? Number(meses) : 3,
      anchorMonth,
      false,
      startMonth,
    );
    res.json(data);
  } catch {
    res.status(500).json({ error: "Erro ao buscar acurácia por unidade" });
  }
};

// ── Produtos Crónicos ──────────────────────────────────────────────────────

export const getProdutosCronicos = async (req: AuthRequest, res: Response) => {
  const { unidadeVendaId, ciclos, threshold } = req.query;

  if (req.user!.perfil === "gestor") {
    if (unidadeVendaId && !req.user!.unidadeCodigos.includes(unidadeVendaId as string)) {
      return res.status(403).json({ error: "Acesso negado à unidade solicitada" });
    }
  }

  try {
    const data = await ForecastService.getProdutosCronicos(
      unidadeVendaId as string | undefined,
      ciclos ? Number(ciclos) : 3,
      threshold ? Number(threshold) : 15
    );
    res.json(data);
  } catch {
    res.status(500).json({ error: "Erro ao buscar produtos crónicos" });
  }
};

// ── Produto Meses: ORC × FCTS × Vendas para um produto × unidade ──────────

export const getProdutoMeses = async (req: AuthRequest, res: Response) => {
  const { unidadeVendaId, produtoId, startMonth, endMonth, paisIso3 } = req.query as {
    unidadeVendaId?: string;
    produtoId?:      string;
    startMonth?:     string;
    endMonth?:       string;
    paisIso3?:       string;
  };

  if (!unidadeVendaId || !produtoId) {
    return res.status(400).json({ error: "unidadeVendaId e produtoId são obrigatórios" });
  }

  if (req.user!.perfil === "gestor") {
    if (!req.user!.unidadeCodigos.includes(unidadeVendaId)) {
      return res.status(403).json({ error: "Acesso negado à unidade solicitada" });
    }
  }

  try {
    const data = await ForecastService.getProdutoMeses(
      unidadeVendaId,
      produtoId,
      startMonth,
      endMonth,
      paisIso3,
    );
    res.json(data);
  } catch {
    res.status(500).json({ error: "Erro ao buscar meses do produto" });
  }
};
