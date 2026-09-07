import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import * as ProdutosController from "../controllers/produtos.controller.js";

const router = Router();

router.use(authenticate);

router.get("/",                                     ProdutosController.getAll);
router.post("/",                    requireRole("operador_pcp", "admin_ti"), ProdutosController.create);
router.put("/:codigo",                              requireRole("operador_pcp", "admin_ti"), ProdutosController.update);
router.delete("/:codigo",                           requireRole("operador_pcp", "admin_ti"), ProdutosController.remove);
router.post("/:codigo/unidades",                    requireRole("operador_pcp", "admin_ti"), ProdutosController.linkUnidade);
router.patch("/:codigo/unidades/:unidadeVendaId",   requireRole("operador_pcp", "admin_ti"), ProdutosController.updateUnidadeLink);
router.delete("/:codigo/unidades/:unidadeVendaId",  requireRole("operador_pcp", "admin_ti"), ProdutosController.unlinkUnidade);

export default router;
