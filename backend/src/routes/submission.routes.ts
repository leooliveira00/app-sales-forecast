import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import {
  listSubmissionsQuery,
  rejectBody,
  submissionByUnitQuery,
  submitBody,
} from "../schemas/submission.schema.js";
import * as SubmissionController from "../controllers/submission.controller.js";

const router = Router();

router.use(authenticate);

router.get("/",               validate({ query: listSubmissionsQuery }),  SubmissionController.list);
router.get("/pending-count",                                             SubmissionController.pendingCount);
router.get("/by-unit",        validate({ query: submissionByUnitQuery }), SubmissionController.getByUnitAndMonth);

// Gestor submete
router.post("/", requireRole("gestor"), validate({ body: submitBody }), SubmissionController.submit);

// PCP/admin_ti decide (consulta tem acesso somente de visualização — Dashboard/Consolidado)
router.patch("/:id/approve",  requireRole("operador_pcp", "admin_ti"), validate({ params: idParamsSchema }),                   SubmissionController.approve);
router.patch("/:id/reject",   requireRole("operador_pcp", "admin_ti"), validate({ params: idParamsSchema, body: rejectBody }), SubmissionController.reject);
router.get("/:id/preview",    requireRole("operador_pcp", "admin_ti"), validate({ params: idParamsSchema }),                   SubmissionController.getPreview);

export default router;
