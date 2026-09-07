import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as CycleController from "../controllers/cycle-readiness.controller.js";

const router = Router();

router.use(authenticate);

// All authenticated users can query (response filtered by role inside controller)
router.get("/", CycleController.list);

// Overview: monitoramento completo — operador_pcp e admin_ti
router.get("/overview", requireRole("operador_pcp", "admin_ti"), CycleController.overview);

// Block: operador_pcp and admin_ti
router.post("/:refMonth/block",    requireRole("operador_pcp", "admin_ti"), CycleController.block);

// Unblock: operador_pcp and admin_ti
router.post("/:refMonth/unblock",  requireRole("operador_pcp", "admin_ti"), CycleController.unblock);

// Close: admin_ti only
router.post("/:refMonth/close",    requireRole("admin_ti"), CycleController.close);

// Rerun: admin_ti only
router.post("/:refMonth/rerun",    requireRole("admin_ti"), CycleController.rerun);

export default router;
