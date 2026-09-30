import { Request, Response } from "express";
import * as ForecastAirflowService from "../services/forecast-airflow.service.js";
import type { AddForecastItemsBody, CreateForecastRunBody } from "../schemas/internal.schema.js";

// ── GET /api/internal/forecast/sales-data ────────────────────────────────

export const getSalesData = async (req: Request, res: Response) => {
  const months        = Math.min(60, Math.max(1, parseInt(String(req.query.months       ?? "36"), 10) || 36));
  const activeMonths  = Math.min(36, Math.max(1, parseInt(String(req.query.activeMonths ?? "12"), 10) || 12));
  const prevRefMonth  = typeof req.query.prevRefMonth === "string" ? req.query.prevRefMonth.trim() : null;

  try {
    if (prevRefMonth) {
      const dataByCycle = await ForecastAirflowService.getSalesDataByCycle(prevRefMonth, months);
      if (dataByCycle !== null) {
        console.log(`[getSalesData] Modo: filtro por ciclo prevRefMonth=${prevRefMonth} → ${dataByCycle.length} registros`);
        return res.json({ total: dataByCycle.length, items: dataByCycle, mode: "cycle" });
      }
      console.log(`[getSalesData] Modo: fallback por vendas (sem ForecastRun SUCCESS para prevRefMonth=${prevRefMonth})`);
    }

    const data = await ForecastAirflowService.getSalesData(months, activeMonths);
    return res.json({ total: data.length, items: data, mode: "sales" });
  } catch (err) {
    console.error("[getSalesData]", err);
    const message = err instanceof Error ? err.message : "Erro ao buscar dados de vendas.";
    return res.status(500).json({ error: message });
  }
};

// ── POST /api/internal/forecast/run ──────────────────────────────────────

export const createRun = async (req: Request, res: Response) => {
  const { refMonth, leadTimeMonths, triggeredBy } = req.body as CreateForecastRunBody;

  try {
    const run = await ForecastAirflowService.createForecastRun(refMonth, leadTimeMonths, triggeredBy);
    return res.status(201).json({
      runId:       run.id,
      refMonth:    run.refMonth,
      windowStart: run.windowStart,
      windowEnd:   run.windowEnd,
    });
  } catch (err) {
    console.error("[createRun]", err);
    const message = err instanceof Error ? err.message : "Erro ao criar ForecastRun.";
    return res.status(500).json({ error: message });
  }
};

// ── POST /api/internal/forecast/run/:runId/finalize ──────────────────────

export const finalizeRun = async (req: Request, res: Response) => {
  const { runId } = req.params;
  try {
    const run = await ForecastAirflowService.finalizeRun(runId);
    return res.json({ ok: true, runId: run.id, status: run.status });
  } catch (err) {
    console.error("[finalizeRun]", err);
    const message = err instanceof Error ? err.message : "Erro ao finalizar run.";
    return res.status(500).json({ error: message });
  }
};

// ── POST /api/internal/forecast/run/:runId/items ─────────────────────────

export const addItems = async (req: Request, res: Response) => {
  const { runId } = req.params;
  const { items } = req.body as AddForecastItemsBody;

  try {
    const result = await ForecastAirflowService.addForecastItems(runId, items);
    return res.status(201).json({ inserted: result.length });
  } catch (err) {
    console.error("[addItems]", err);
    const message = err instanceof Error ? err.message : "Erro ao inserir ForecastItems.";
    return res.status(500).json({ error: message });
  }
};
