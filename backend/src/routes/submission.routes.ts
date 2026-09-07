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

// Controladoria/operador_pcp decide
router.patch("/:id/approve",  requireRole("controladoria", "operador_pcp", "admin_ti"), SubmissionController.approve);
router.patch("/:id/reject",   requireRole("controladoria", "operador_pcp", "admin_ti"), SubmissionController.reject);
router.get("/:id/preview",    requireRole("controladoria", "operador_pcp", "admin_ti"), SubmissionController.getPreview);

export default router;
