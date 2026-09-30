import { Router } from "express";
import { internalAuth } from "../middleware/internal-auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { deleteStatusBody, finalizeExportBody, logIdQuery, progressBody } from "../schemas/internal.schema.js";
import * as ProtheusExportController from "../controllers/protheus-export.controller.js";

const router = Router();

// Todas as rotas usam token interno (para a DAG Airflow)
router.use(internalAuth);

// A DAG busca os itens PENDING para processar
router.get("/data", validate({ query: logIdQuery }), ProtheusExportController.getExportData);

// A DAG verifica se o log ainda está RUNNING (dead-man's switch para cancelamento)
router.get("/log-status", validate({ query: logIdQuery }), ProtheusExportController.getLogStatus);

// A DAG reporta status do DELETE por unidade
router.post("/delete-status", validate({ body: deleteStatusBody }), ProtheusExportController.reportDeleteStatus);

// A DAG reporta progresso de cada POST por mês×unidade
router.post("/progress", validate({ body: progressBody }), ProtheusExportController.reportProgress);

// A DAG reporta conclusão (status final)
router.post("/finalize", validate({ body: finalizeExportBody }), ProtheusExportController.finalize);

export default router;
