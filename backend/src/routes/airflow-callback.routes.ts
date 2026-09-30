import { Router } from "express";
import { internalAuth } from "../middleware/internal-auth.middleware.js";
import { handleCallback, handleOrchestratorFailed } from "../controllers/airflow-callback.controller.js";

const router = Router();

// Chamadas pelas DAGs com INTERNAL_SYNC_TOKEN (comparação timing-safe no internalAuth)
router.post("/callback",      internalAuth, handleCallback);
router.post("/cycle-failed",  internalAuth, handleOrchestratorFailed);

export default router;
