import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import { internalAuth } from "../middleware/internal-auth.middleware.js";
import * as ProtheusSyncController from "../controllers/protheus-sync.controller.js";
import * as VendasSyncController from "../controllers/vendas-sync.controller.js";

// ── Rotas internas — autenticadas via Service Token (chamadas pelo Airflow) ───
const internalRouter = Router();
internalRouter.post("/produtos", internalAuth, ProtheusSyncController.receiveProdutos);
internalRouter.post("/vendas",   internalAuth, VendasSyncController.receiveVendas);

// ── Rotas admin — autenticadas via JWT de usuário (chamadas pela UI) ──────────
const adminRouter = Router();
adminRouter.use(authenticate);
adminRouter.use(requireRole("operador_pcp", "admin_ti"));
adminRouter.get("/logs",              ProtheusSyncController.getLogs);
adminRouter.get("/logs/:id",          ProtheusSyncController.getLog);
adminRouter.get("/vendas/logs",       VendasSyncController.getLogs);
adminRouter.get("/vendas/logs/:id",   VendasSyncController.getLog);

export { internalRouter as protheusInternalRoutes, adminRouter as protheusAdminRoutes };
