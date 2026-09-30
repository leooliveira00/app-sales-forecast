import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { idParamsSchema } from "../schemas/common.schema.js";
import { createRequiredDagBody, updateRequiredDagBody } from "../schemas/cycle.schema.js";
import * as DagsController from "../controllers/cycle-required-dags.controller.js";

const router = Router();

router.use(authenticate);

// Read: operador_pcp and admin_ti
router.get("/",    requireRole("operador_pcp", "admin_ti"), DagsController.list);

// Write: admin_ti only
router.post("/",       requireRole("admin_ti"), validate({ body: createRequiredDagBody }),                         DagsController.create);
router.patch("/:id",   requireRole("admin_ti"), validate({ params: idParamsSchema, body: updateRequiredDagBody }), DagsController.update);
router.delete("/:id",  requireRole("admin_ti"), validate({ params: idParamsSchema }),                              DagsController.remove);

export default router;
