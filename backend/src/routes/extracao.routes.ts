import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import { ROLES } from "../constants/roles.js";
import * as ExtracaoController from "../controllers/extracao.controller.js";

const router = Router();

router.use(authenticate);

// Todos os perfis extraem; o escopo de unidades é resolvido por perfil no service
// (gestor vê apenas as suas — ver resolverUnidadesAutorizadas).
const perfisComAcesso = [
  ROLES.GESTOR, ROLES.OPERADOR_PCP, ROLES.ADMIN_TI, ROLES.CONSULTA,
];

router.get("/filtros", requireRole(...perfisComAcesso), ExtracaoController.getFiltros);
router.post("/csv",    requireRole(...perfisComAcesso), ExtracaoController.postCsv);

export default router;
