import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// validateEnv() em app.ts garante que JWT_SECRET está definido antes de chegar aqui
const EFFECTIVE_JWT_SECRET = process.env.JWT_SECRET!;

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    perfil: string;
    unidadeCodigos: string[];  // códigos de negócio das UnidadeVenda vinculadas (ex.: ["3201002", "3201003"])
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Não autorizado" });

  try {
    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET) as AuthRequest["user"];
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.perfil)) {
      return res.status(403).json({ error: "Acesso negado" });
    }
    next();
  };
};
