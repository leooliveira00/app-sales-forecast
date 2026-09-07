import { Request, Response } from "express";
import { markStep, getOrCreate, forceFailCycle } from "../services/cycle-readiness.service.js";
import * as SnapshotService from "../services/snapshot.service.js";
import { appCache } from "../utils/cache.js";
import prisma from "../config/prisma.js";

const TOKEN = process.env.INTERNAL_SYNC_TOKEN ?? "";
const MAX_AGE_MINUTES = 30;

export const handleOrchestratorFailed = async (req: Request, res: Response) => {
  const token = req.headers["authorization"]?.toString().replace("Bearer ", "");
  if (!TOKEN || token !== TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { refMonth } = req.body;
  if (!refMonth) {
    return res.status(400).json({ error: "refMonth is required" });
  }

  try {
    await forceFailCycle(refMonth);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[airflow-cycle-failed]", err);
    return res.status(500).json({ error: "Internal error processing orchestrator failure" });
  }
};

export const handleCallback = async (req: Request, res: Response) => {
  // Token auth
  const token = req.headers["authorization"]?.toString().replace("Bearer ", "");
  if (!TOKEN || token !== TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { dag_id, dag_run_id, state, refMonth, issued_at, dataRefMonth } = req.body;

  // Basic field validation
  if (!dag_id || !dag_run_id || !state || !refMonth) {
    return res.status(400).json({ error: "dag_id, dag_run_id, state and refMonth are required" });
  }

  // TTL check (replay protection)
  if (issued_at) {
    const issuedMs = new Date(issued_at).getTime();
    if (isNaN(issuedMs) || Date.now() - issuedMs > MAX_AGE_MINUTES * 60_000) {
      return res.status(400).json({ error: "issued_at too old or invalid" });
    }
  }

  // Only process DAGs registered and enabled in CycleRequiredDag
  const registeredDag = await prisma.cycleRequiredDag.findFirst({
    where: { dagId: dag_id, enabled: true },
  });

  if (!registeredDag) {
    // Silently accept — unknown DAG, no action needed
    return res.json({ ok: true, ignored: true, reason: "dag_not_registered" });
  }

  if (state !== "success" && state !== "failed") {
    return res.json({ ok: true, ignored: true, reason: "irrelevant_state" });
  }

  try {
    await getOrCreate(refMonth);
    const newGate = await markStep(refMonth, dag_id, dag_run_id, state as "success" | "failed");

    // Side-effect específico do protheus_vendas_sync: refresh de snapshots após
    // todos os lotes terem sido processados (substitui o disparo per-batch que
    // antes acontecia em vendas-sync.service.ts).
    if (dag_id === "protheus_vendas_sync" && state === "success") {
      const yearSource = typeof dataRefMonth === "string" && dataRefMonth.trim()
        ? dataRefMonth
        : refMonth;
      const affectedYear = new Date(yearSource).getUTCFullYear();
      appCache.invalidateAnalytics();
      void SnapshotService.refreshConsolidadoSnapshot(affectedYear)
        .catch(err => console.error("[snapshot] refreshConsolidadoSnapshot (post-vendas-sync) failed:", err));
      void SnapshotService.refreshAcuraciaSnapshot()
        .catch(err => console.error("[snapshot] refreshAcuraciaSnapshot (post-vendas-sync) failed:", err));
    }

    return res.json({ ok: true, gate: newGate });
  } catch (err) {
    console.error("[airflow-callback]", err);
    return res.status(500).json({ error: "Internal error processing callback" });
  }
};
