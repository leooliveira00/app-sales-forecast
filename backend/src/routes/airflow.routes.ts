import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as AirflowController from "../controllers/airflow.controller.js";

const router = Router();

router.use(authenticate);

// ── Read-only: admin_ti only ─────────────────────────────────────────────────
router.get("/status",                                                    requireRole("admin_ti"), AirflowController.getStatus);
router.get("/dags",                                                      requireRole("admin_ti"), AirflowController.listDags);
router.get("/dags/:dagId/runs",                                          requireRole("admin_ti"), AirflowController.getDagRuns);
router.get("/dags/:dagId/runs/:runId/tasks",                             requireRole("admin_ti"), AirflowController.getTaskInstances);
router.get("/dags/:dagId/runs/:runId/tasks/:taskId/logs/:tryNumber",     requireRole("admin_ti"), AirflowController.getTaskLog);
router.get("/variables",                                                  requireRole("admin_ti"), AirflowController.listVariables);

// ── Write: admin_ti only ─────────────────────────────────────────────────────
router.post("/dags/:dagId/trigger",              requireRole("admin_ti"), AirflowController.triggerDag);
router.patch("/dags/:dagId/pause",               requireRole("admin_ti"), AirflowController.pauseDag);
router.patch("/dags/:dagId/runs/:runId/cancel",  requireRole("admin_ti"), AirflowController.cancelDagRun);
router.post("/dags/:dagId/runs/:runId/clear",    requireRole("admin_ti"), AirflowController.clearDagRun);
router.post("/variables",                        requireRole("admin_ti"), AirflowController.createVariable);
router.patch("/variables/:key",                  requireRole("admin_ti"), AirflowController.updateVariable);
router.delete("/variables/:key",                 requireRole("admin_ti"), AirflowController.deleteVariable);

export default router;
