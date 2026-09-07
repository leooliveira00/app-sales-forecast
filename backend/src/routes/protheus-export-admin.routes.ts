import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as ProtheusExportController from "../controllers/protheus-export.controller.js";

const router = Router();

// Todas as rotas exigem autenticação JWT
router.use(authenticate);

// Leitura: operador_pcp + admin_ti
router.get(
  "/status/:refMonth",
  requireRole("operador_pcp", "admin_ti"),
  ProtheusExportController.checkStatus
);

router.get(
  "/csv",
  requireRole("operador_pcp", "admin_ti"),
  ProtheusExportController.downloadCsv
);

router.get(
  "/logs",
  requireRole("operador_pcp", "admin_ti"),
  ProtheusExportController.listLogs
);

router.get(
  "/logs/:id",
  requireRole("operador_pcp", "admin_ti"),
  ProtheusExportController.getLogDetail
);

// Ações: operador_pcp + admin_ti
router.post(
  "/",
  requireRole("operador_pcp", "admin_ti"),
  ProtheusExportController.triggerExport
);

router.post(
  "/:logId/retry-failed",
  requireRole("operador_pcp", "admin_ti"),
  ProtheusExportController.retryFailed
);

router.post(
  "/:logId/cancel",
  requireRole("operador_pcp", "admin_ti"),
  ProtheusExportController.cancelExport
);

export default router;
