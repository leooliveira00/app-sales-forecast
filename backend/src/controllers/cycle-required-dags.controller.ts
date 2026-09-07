import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware.js";
import prisma from "../config/prisma.js";

export const list = async (_req: AuthRequest, res: Response) => {
  try {
    const dags = await prisma.cycleRequiredDag.findMany({ orderBy: { order: "asc" } });
    res.json(dags);
  } catch {
    res.status(500).json({ error: "Erro ao listar DAGs" });
  }
};

export const create = async (req: AuthRequest, res: Response) => {
  const { dagId, label, enabled, order } = req.body;
  if (!dagId?.trim() || !label?.trim()) {
    return res.status(400).json({ error: "dagId e label são obrigatórios." });
  }
  try {
    const dag = await prisma.cycleRequiredDag.create({
      data: { dagId: dagId.trim(), label: label.trim(), enabled: enabled ?? true, order: order ?? 0 },
    });
    res.status(201).json(dag);
  } catch {
    res.status(400).json({ error: "dagId já cadastrado ou inválido." });
  }
};

export const update = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { label, enabled, order } = req.body;
  try {
    const dag = await prisma.cycleRequiredDag.update({
      where: { id },
      data:  {
        ...(label   !== undefined && { label }),
        ...(enabled !== undefined && { enabled }),
        ...(order   !== undefined && { order }),
      },
    });
    res.json(dag);
  } catch {
    res.status(404).json({ error: "DAG não encontrada." });
  }
};

export const remove = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.cycleRequiredDag.delete({ where: { id } });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "DAG não encontrada." });
  }
};
