import { Router } from "express";
import { internalAuth } from "../middleware/internal-auth.middleware.js";
import * as ProtheusExportController from "../controllers/protheus-export.controller.js";

const router = Router();

// Todas as rotas usam token interno (para a DAG Airflow)
router.use(internalAuth);

// A DAG busca os itens PENDING para processar
router.get("/data", ProtheusExportController.getExportData);

// A DAG verifica se o log ainda está RUNNING (dead-man's switch para cancelamento)
router.get("/log-status", ProtheusExportController.getLogStatus);

// A DAG reporta status do DELETE por unidade
router.post("/delete-status", ProtheusExportController.reportDeleteStatus);

// A DAG reporta progresso de cada POST por mês×unidade
router.post("/progress", ProtheusExportController.reportProgress);

// A DAG reporta conclusão (status final)
router.post("/finalize", ProtheusExportController.finalize);

export default router;
