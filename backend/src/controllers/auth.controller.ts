import { Request, Response } from "express";
import * as AuthService from "../services/auth.service.js";
import { AuthRequest } from "../middleware/auth.middleware.js";

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "E-mail e senha são obrigatórios" });
  }

  const result = await AuthService.login(email, password);

  if (!result) {
    return res.status(401).json({ error: "Credenciais inválidas" });
  }

  res.json(result);
};

export const logout = async (req: AuthRequest, res: Response) => {
  if (req.user?.id) {
    await AuthService.logout(req.user.id);
  }
  res.status(204).end();
};
