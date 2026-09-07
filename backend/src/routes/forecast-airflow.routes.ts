import { Router } from "express";
import { internalAuth } from "../middleware/internal-auth.middleware.js";
import * as ForecastAirflowController from "../controllers/forecast-airflow.controller.js";

const router = Router();

// Todas as rotas exigem o token interno do Airflow
router.get( "/sales-data",          internalAuth, ForecastAirflowController.getSalesData);
router.post("/run",                  internalAuth, ForecastAirflowController.createRun);
router.post("/run/:runId/items",     internalAuth, ForecastAirflowController.addItems);
router.post("/run/:runId/finalize",  internalAuth, ForecastAirflowController.finalizeRun);

export default router;
