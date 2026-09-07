import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as ForecastController from "../controllers/forecast.controller.js";

const router = Router();

router.use(authenticate);

// Runs (operador_pcp gerencia, todos podem ler)
router.get("/runs",                              ForecastController.getRuns);
router.get("/runs/next-release",                 ForecastController.getNextRelease);
router.get("/runs/all",                          requireRole("operador_pcp"), ForecastController.getAllRuns);
router.post("/runs",                             requireRole("operador_pcp"), ForecastController.createRun);
router.post("/runs/:runId/items",                requireRole("operador_pcp"), ForecastController.addItemsToRun);
router.patch("/runs/:runId/availability",        requireRole("operador_pcp"), ForecastController.updateRunAvailability);

// Gestão de portfólio por ciclo (gestores ajustam os produtos do seu run)
router.post("/runs/:runId/products",                      requireRole("gestor"), ForecastController.addManualProductToRun);
router.delete("/runs/:runId/products/:produtoId",         requireRole("gestor"), ForecastController.excludeProductFromRun);
router.put("/runs/:runId/products/:produtoId/restore",    requireRole("gestor"), ForecastController.restoreProductInRun);

// Items (todos os perfis autenticados)
router.get("/items",         ForecastController.getItems);
router.get("/items-annual",  ForecastController.getAnnualItems);

// Overrides — apenas gestores salvam FCTS (unidades nacionais)
router.put("/overrides",                         requireRole("gestor"), ForecastController.upsertOverride);
router.put("/overrides/bulk",                    requireRole("gestor"), ForecastController.bulkUpsertOverride);
router.delete("/overrides/:forecastItemId",      requireRole("gestor"), ForecastController.deleteOverride);

// Dashboard summary (todas as unidades do usuário)
router.get("/summary",           ForecastController.getDashboardSummary);

// Produtos pendentes (sem FCTS na janela) — detalhamento do card "Produtos Preenchidos"
router.get("/pendentes",         ForecastController.getPendingItems);

// Desvios críticos (SKUs com |FCTS - ORC| / ORC > threshold)
router.get("/desvios",           ForecastController.getDesviosCriticos);

// Tendência da unidade: ORC × FCTS × Vendas — últimos N meses
router.get("/tendencia",         ForecastController.getUnitTendencia);

// Acurácia por unidade
router.get("/acuracia-unidades", requireRole("operador_pcp", "admin_ti", "gestor", "controladoria", "consulta"), ForecastController.getAcuraciaUnidades);

// Produtos crónicos (desvio persistente em N ciclos)
router.get("/produtos-cronicos", ForecastController.getProdutosCronicos);

// Meses de um produto: ORC × FCTS × Vendas (últimos 12M)
router.get("/produto-meses", ForecastController.getProdutoMeses);

export default router;
