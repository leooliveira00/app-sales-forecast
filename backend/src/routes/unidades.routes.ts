import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as UnidadesController from "../controllers/unidades.controller.js";

const router = Router();

router.use(authenticate);

router.get("/", UnidadesController.getAll);
router.get("/:codigo", UnidadesController.getByCodigo);
router.post("/", requireRole("operador_pcp", "admin_ti"), UnidadesController.create);
router.put("/:codigo", requireRole("operador_pcp", "admin_ti"), UnidadesController.update);

export default router;
