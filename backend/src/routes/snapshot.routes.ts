import { Router, Response } from "express";
import { AuthRequest, authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as SnapshotService from "../services/snapshot.service.js";
import prisma from "../config/prisma.js";

const router = Router();

/**
 * POST /api/admin/snapshots/refresh
 * Recomputa manualmente os snapshots de consolidado e acurácia.
 * Útil após db:push, importações manuais de dados ou qualquer situação
 * em que os hooks de escrita normais não tenham disparado.
 *
 * Body (opcional):
 *   { year?: number, anchorMonth?: "YYYY-MM", fullAcuraciaBackfill?: boolean }
 *
 * fullAcuraciaBackfill=true → recalcula AcuraciaSnapshot para todos os meses
 * distintos de VendaMensal, garantindo cobertura histórica completa.
 * Necessário uma única vez para dados de 2024/2025 já fechados.
 *
 * Resposta: { ok: true, durationMs: number }
 */
router.post(
  "/refresh",
  authenticate,
  requireRole("admin_ti"),
  async (req: AuthRequest, res: Response) => {
    const { year, anchorMonth, fullAcuraciaBackfill } = req.body as {
      year?: number;
      anchorMonth?: string;
      fullAcuraciaBackfill?: boolean;
    };
    const startedAt = Date.now();

    try {
      if (year) {
        await SnapshotService.refreshConsolidadoSnapshot(Number(year));
      } else {
        // Sem year: refresca todos os anos com OrcamentoRun
        const orcRuns = await prisma.orcamentoRun.findMany({
          select:  { ano: true },
          orderBy: { ano: "asc" },
        });
        for (const run of orcRuns) {
          await SnapshotService.refreshConsolidadoSnapshot(run.ano);
        }
      }

      if (fullAcuraciaBackfill) {
        await SnapshotService.backfillAcuraciaSnapshots();
      } else {
        await SnapshotService.refreshAcuraciaSnapshot({ anchorMonth });
      }

      res.json({ ok: true, durationMs: Date.now() - startedAt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao recomputar snapshots";
      console.error("[snapshot] manual refresh failed:", err);
      res.status(500).json({ error: msg });
    }
  }
);

export default router;
