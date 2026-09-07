import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as AuditService from "../services/audit.service.js";

export const getAuditLogs = async (req: AuthRequest, res: Response) => {
  const {
    refMonth,
    unidadeId,
    produtoId,
    userId,
    entity,
    operation,
    paisIso3,
    page  = "1",
    limit = "50",
  } = req.query;

  try {
    const result = await AuditService.queryAuditLogs(
      {
        refMonth:  refMonth  as string | undefined,
        unidadeId: unidadeId as string | undefined,
        produtoId: produtoId as string | undefined,
        userId:    userId    as string | undefined,
        entity:    entity    as string | undefined,
        operation: operation as string | undefined,
        paisIso3:  paisIso3  as string | undefined,
      },
      parseInt(page  as string, 10) || 1,
      parseInt(limit as string, 10) || 50,
    );
    res.json(result);
  } catch {
    res.status(500).json({ error: "Erro ao buscar trilha de auditoria" });
  }
};

export const getItemHistory = async (req: AuthRequest, res: Response) => {
  const { forecastItemId } = req.params;

  try {
    const history = await AuditService.getItemHistory(forecastItemId);
    res.json(history);
  } catch {
    res.status(500).json({ error: "Erro ao buscar histórico do item" });
  }
};
