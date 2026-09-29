import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { HttpError } from "../utils/http-error.js";

/** Rotas /api inexistentes respondem JSON em vez da página HTML padrão do Express. */
export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
};

/**
 * Handler de erro centralizado — último middleware da cadeia em app.ts.
 * Padroniza toda resposta de erro como `{ error: string }`, o mesmo formato que os
 * controllers já devolvem nos seus try/catch. Erros inesperados são logados e
 * respondidos com mensagem genérica (sem vazar stack/detalhes internos).
 */
export const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => {
  // Resposta já começou a ser enviada: só o handler padrão consegue encerrar a conexão.
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: err.message });
  }

  // Erros do body-parser (JSON malformado, payload acima do limite) já trazem status 4xx.
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return res.status(status).json({ error: "Requisição inválida." });
  }

  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: "Erro interno do servidor." });
};
