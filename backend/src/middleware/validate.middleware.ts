import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/http-error.js";

// Mensagens padrão do zod em português (as mensagens definidas nos schemas têm precedência).
z.config(z.locales.pt());

interface RequestSchemas {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
}

const formatIssues = (error: z.ZodError) =>
  error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");

/**
 * Valida params/query/body contra schemas zod antes do controller.
 * Em caso de falha, encaminha HttpError(400) ao errorHandler — resposta `{ error }`.
 * Em caso de sucesso, substitui o valor original pelo parseado (strings já com trim,
 * campos desconhecidos removidos), então o controller lê dados já normalizados.
 */
export const validate =
  (schemas: RequestSchemas) => (req: Request, _res: Response, next: NextFunction) => {
    for (const key of ["params", "query", "body"] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) return next(new HttpError(400, formatIssues(result.error)));

      Object.assign(req, { [key]: result.data });
    }
    next();
  };
