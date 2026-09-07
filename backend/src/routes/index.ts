import { Router } from "express";
import authRoutes            from "./auth.routes.js";
import usersRoutes           from "./users.routes.js";
import unidadesRoutes        from "./unidades.routes.js";
import produtosRoutes        from "./produtos.routes.js";
import forecastRoutes        from "./forecast.routes.js";
import submissionRoutes      from "./submission.routes.js";
import orcamentoRoutes       from "./orcamento.routes.js";
import paisRoutes            from "./pais.routes.js";
import systemConfigRoutes    from "./system-config.routes.js";
import airflowRoutes         from "./airflow.routes.js";
import airflowCallbackRoutes from "./airflow-callback.routes.js";
import cycleReadinessRoutes  from "./cycle-readiness.routes.js";
import cycleDagsRoutes       from "./cycle-required-dags.routes.js";
import notificationsRoutes   from "./notifications.routes.js";
import { protheusInternalRoutes, protheusAdminRoutes } from "./protheus-sync.routes.js";
import forecastAirflowRoutes       from "./forecast-airflow.routes.js";
import snapshotRoutes              from "./snapshot.routes.js";
import protheusExportAdminRoutes   from "./protheus-export-admin.routes.js";
import protheusExportInternalRoutes from "./protheus-export-internal.routes.js";
import auditRoutes                  from "./audit.routes.js";
import treinamentoRoutes            from "./treinamento.routes.js";
import extracaoRoutes               from "./extracao.routes.js";

const router = Router();

router.use("/auth",              authRoutes);
router.use("/users",             usersRoutes);
router.use("/unidades",          unidadesRoutes);
router.use("/produtos",          produtosRoutes);
router.use("/forecast",          forecastRoutes);
router.use("/submissions",       submissionRoutes);
router.use("/orcamento",         orcamentoRoutes);
router.use("/paises",            paisRoutes);
router.use("/admin/config",      systemConfigRoutes);
router.use("/airflow",           airflowCallbackRoutes);  // /api/airflow/callback (public, token-auth)
router.use("/airflow",           airflowRoutes);          // remaining airflow routes (JWT-auth)
router.use("/cycle-readiness",   cycleReadinessRoutes);
router.use("/cycle-required-dags", cycleDagsRoutes);
router.use("/notifications",     notificationsRoutes);
router.use("/internal/sync",              protheusInternalRoutes);
router.use("/internal/forecast",          forecastAirflowRoutes);
router.use("/internal/protheus-export",   protheusExportInternalRoutes);
router.use("/admin/protheus",             protheusAdminRoutes);
router.use("/admin/protheus/export",      protheusExportAdminRoutes);
router.use("/admin/snapshots",            snapshotRoutes);
router.use("/audit",                      auditRoutes);
router.use("/treinamentos",               treinamentoRoutes);
router.use("/extracao",                   extracaoRoutes);

export default router;
