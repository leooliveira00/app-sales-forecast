import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as AuthController from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Muitas tentativas de login. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/login", loginLimiter, AuthController.login);
router.post("/logout", authenticate, AuthController.logout);

export default router;
