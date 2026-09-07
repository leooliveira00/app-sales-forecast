import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as PaisService from "../services/pais.service.js";

export const getAll = async (req: AuthRequest, res: Response) => {
  const { unidadeVendaId } = req.query;
  try {
    const data = unidadeVendaId
      ? await PaisService.listByUnidade(unidadeVendaId as string)
      : await PaisService.listAll();
    res.json(data);
  } catch {
    res.status(500).json({ error: "Erro ao buscar países" });
  }
};

export const create = async (req: AuthRequest, res: Response) => {
  const { iso3, nome, unidadeVendaId } = req.body;
  if (!iso3 || !nome || !unidadeVendaId)
    return res.status(400).json({ error: "iso3, nome e unidadeVendaId são obrigatórios" });

  try {
    const pais = await PaisService.create({ iso3, nome, unidadeVendaId });
    res.status(201).json(pais);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro ao criar país";
    res.status(400).json({ error: msg });
  }
};

export const update = async (req: AuthRequest, res: Response) => {
  const { iso3 } = req.params;
  const { nome, ativo } = req.body;
  try {
    const pais = await PaisService.update(iso3, { nome, ativo });
    res.json(pais);
  } catch {
    res.status(400).json({ error: "Erro ao atualizar país" });
  }
};

export const remove = async (req: AuthRequest, res: Response) => {
  const { iso3 } = req.params;
  try {
    await PaisService.remove(iso3);
    res.status(204).send();
  } catch {
    res.status(400).json({ error: "Erro ao remover país" });
  }
};
