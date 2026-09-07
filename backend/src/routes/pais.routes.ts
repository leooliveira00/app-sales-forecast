import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as PaisController from "../controllers/pais.controller.js";

const router = Router();

router.get(  "/",     authenticate,                             PaisController.getAll);
router.post( "/",     authenticate, requireRole("operador_pcp"),       PaisController.create);
router.put(   "/:iso3", authenticate, requireRole("operador_pcp"),     PaisController.update);
router.delete("/:iso3", authenticate, requireRole("operador_pcp"),     PaisController.remove);

export default router;
