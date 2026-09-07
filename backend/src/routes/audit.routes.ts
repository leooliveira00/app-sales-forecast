import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as AuditController from "../controllers/audit.controller.js";

const router = Router();

router.use(authenticate);
router.use(requireRole("operador_pcp", "admin_ti"));

router.get("/",                           AuditController.getAuditLogs);
router.get("/item/:forecastItemId",       AuditController.getItemHistory);

export default router;
