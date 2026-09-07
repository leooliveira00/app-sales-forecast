import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as DagsController from "../controllers/cycle-required-dags.controller.js";

const router = Router();

router.use(authenticate);

// Read: operador_pcp and admin_ti
router.get("/",    requireRole("operador_pcp", "admin_ti"), DagsController.list);

// Write: admin_ti only
router.post("/",       requireRole("admin_ti"), DagsController.create);
router.patch("/:id",   requireRole("admin_ti"), DagsController.update);
router.delete("/:id",  requireRole("admin_ti"), DagsController.remove);

export default router;
