import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import { avatarUpload } from "../middleware/upload.middleware.js";
import * as UsersController from "../controllers/users.controller.js";

const router = Router();

router.use(authenticate);

router.get("/",                                    requireRole("operador_pcp", "admin_ti", "controladoria"), UsersController.getAll);
router.post("/",                                   requireRole("operador_pcp", "admin_ti"),                  UsersController.create);
router.put("/:id",                                 requireRole("operador_pcp", "admin_ti"),                  UsersController.update);
router.delete("/:id",                              requireRole("operador_pcp", "admin_ti"),                  UsersController.remove);
router.post("/:id/unidades",                       requireRole("operador_pcp", "admin_ti"),                  UsersController.addUnidade);
router.delete("/:id/unidades/:unidadeVendaId",     requireRole("operador_pcp", "admin_ti"),                  UsersController.removeUnidade);

// Avatar — próprio usuário ou admin
router.post("/:id/avatar",   avatarUpload.single("avatar"), UsersController.uploadAvatar);
router.delete("/:id/avatar",                                UsersController.deleteAvatar);

export default router;
