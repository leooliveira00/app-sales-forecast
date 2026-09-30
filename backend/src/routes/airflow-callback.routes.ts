import { Router } from "express";
import { internalAuth } from "../middleware/internal-auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { airflowCallbackBody, cycleFailedBody } from "../schemas/internal.schema.js";
import { handleCallback, handleOrchestratorFailed } from "../controllers/airflow-callback.controller.js";

const router = Router();

// Chamadas pelas DAGs com INTERNAL_SYNC_TOKEN (comparação timing-safe no internalAuth)
router.post("/callback",      internalAuth, validate({ body: airflowCallbackBody }), handleCallback);
router.post("/cycle-failed",  internalAuth, validate({ body: cycleFailedBody }),     handleOrchestratorFailed);

export default router;
