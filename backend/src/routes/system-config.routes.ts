import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as SystemConfigController from "../controllers/system-config.controller.js";

const router = Router();

// Todas as rotas requerem autenticação e papel operador_pcp ou admin_ti
router.use(authenticate);
router.use(requireRole("operador_pcp", "admin_ti"));

router.get("/",  SystemConfigController.getConfig);
router.put("/",  SystemConfigController.updateConfig);

export default router;
