import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as OrcamentoController from "../controllers/orcamento.controller.js";

const router = Router();

// Todos os autenticados podem consultar
router.get("/runs",                    authenticate, OrcamentoController.getRuns);
router.get("/consolidado",                    authenticate, OrcamentoController.getConsolidado);
router.get("/consolidado/unidade/paises",      authenticate, OrcamentoController.getConsolidadoUnidadePaises);
router.get("/consolidado/unidade/pais-detail", authenticate, OrcamentoController.getConsolidadoUnidadePaisDetail);
router.get("/consolidado/unidade",             authenticate, OrcamentoController.getConsolidadoUnidade);

// Apenas operador_pcp pode criar/alterar runs e itens
router.post("/runs",              authenticate, requireRole("operador_pcp"), OrcamentoController.createRun);
router.post("/runs/:ano/items",   authenticate, requireRole("operador_pcp"), OrcamentoController.upsertItems);

export default router;
