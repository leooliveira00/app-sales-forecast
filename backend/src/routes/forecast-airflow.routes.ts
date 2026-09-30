import { Router } from "express";
import { internalAuth } from "../middleware/internal-auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { addForecastItemsBody, createForecastRunBody, runIdParams } from "../schemas/internal.schema.js";
import * as ForecastAirflowController from "../controllers/forecast-airflow.controller.js";

const router = Router();

// Todas as rotas exigem o token interno do Airflow
router.get( "/sales-data",          internalAuth, ForecastAirflowController.getSalesData);
router.post("/run",                  internalAuth, validate({ body: createForecastRunBody }),                      ForecastAirflowController.createRun);
router.post("/run/:runId/items",     internalAuth, validate({ params: runIdParams, body: addForecastItemsBody }), ForecastAirflowController.addItems);
router.post("/run/:runId/finalize",  internalAuth, validate({ params: runIdParams }),                            ForecastAirflowController.finalizeRun);

export default router;
