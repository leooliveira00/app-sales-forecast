import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  blockCycleBody,
  closeCycleBody,
  cycleRefMonthParams,
  rerunCycleBody,
  unblockCycleBody,
} from "../schemas/cycle.schema.js";
import * as CycleController from "../controllers/cycle-readiness.controller.js";

const router = Router();

router.use(authenticate);

// All authenticated users can query (response filtered by role inside controller)
router.get("/", CycleController.list);

// Overview: monitoramento completo — operador_pcp e admin_ti
router.get("/overview", requireRole("operador_pcp", "admin_ti"), CycleController.overview);

// Block: operador_pcp and admin_ti
router.post("/:refMonth/block",    requireRole("operador_pcp", "admin_ti"), validate({ params: cycleRefMonthParams, body: blockCycleBody }),   CycleController.block);

// Unblock: operador_pcp and admin_ti
router.post("/:refMonth/unblock",  requireRole("operador_pcp", "admin_ti"), validate({ params: cycleRefMonthParams, body: unblockCycleBody }), CycleController.unblock);

// Close: admin_ti only
router.post("/:refMonth/close",    requireRole("admin_ti"),                 validate({ params: cycleRefMonthParams, body: closeCycleBody }),   CycleController.close);

// Rerun: admin_ti only
router.post("/:refMonth/rerun",    requireRole("admin_ti"),                 validate({ params: cycleRefMonthParams, body: rerunCycleBody }),   CycleController.rerun);

export default router;
