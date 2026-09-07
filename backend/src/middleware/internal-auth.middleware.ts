import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";

// Token lido de forma lazy dentro da função para garantir que o dotenv.config()
// já tenha sido executado antes da primeira requisição chegar.
export const internalAuth = (req: Request, res: Response, next: NextFunction) => {
  const syncToken = process.env.INTERNAL_SYNC_TOKEN;

  if (!syncToken) {
    return res.status(503).json({ error: "Serviço indisponível: token interno não configurado." });
  }

  const provided = req.headers.authorization?.split(" ")[1];

  if (!provided) {
    return res.status(401).json({ error: "Token inválido ou ausente." });
  }

  try {
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(syncToken);
    const isValid     = providedBuf.length === expectedBuf.length
                        && timingSafeEqual(providedBuf, expectedBuf);
    if (!isValid) return res.status(401).json({ error: "Token inválido ou ausente." });
  } catch {
    return res.status(401).json({ error: "Token inválido ou ausente." });
  }

  next();
};
