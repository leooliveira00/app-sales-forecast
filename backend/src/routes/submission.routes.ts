import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as SubmissionController from "../controllers/submission.controller.js";

const router = Router();

router.use(authenticate);

router.get("/",               SubmissionController.list);
router.get("/pending-count",  SubmissionController.pendingCount);
router.get("/by-unit",        SubmissionController.getByUnitAndMonth);

// Gestor submete
router.post("/", requireRole("gestor"), SubmissionController.submit);

// PCP/admin_ti decide (controladoria tem acesso somente de visualização — Dashboard/Consolidado)
router.patch("/:id/approve",  requireRole("operador_pcp", "admin_ti"), SubmissionController.approve);
router.patch("/:id/reject",   requireRole("operador_pcp", "admin_ti"), SubmissionController.reject);
router.get("/:id/preview",    requireRole("operador_pcp", "admin_ti"), SubmissionController.getPreview);

export default router;
