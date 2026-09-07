import { Router } from "express";
import { handleCallback, handleOrchestratorFailed } from "../controllers/airflow-callback.controller.js";

const router = Router();

router.post("/callback",      handleCallback);
router.post("/cycle-failed",  handleOrchestratorFailed);

export default router;
