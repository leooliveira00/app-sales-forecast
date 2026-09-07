import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as UnidadesService from "../services/unidades.service.js";

export const getAll = async (_req: AuthRequest, res: Response) => {
  try {
    const unidades = await UnidadesService.findAll();
    res.json(unidades);
  } catch {
    res.status(500).json({ error: "Erro ao buscar unidades de venda" });
  }
};

export const create = async (req: AuthRequest, res: Response) => {
  const { codigo, descricao, tipo, config } = req.body;

  if (!codigo || !descricao)
    return res.status(400).json({ error: "Campos obrigatórios: codigo e descricao" });

  if (tipo && !["NACIONAL", "EXPORT"].includes(tipo))
    return res.status(400).json({ error: "tipo deve ser NACIONAL ou EXPORT" });

  try {
    const unidade = await UnidadesService.create({ codigo, descricao, tipo, config });
    res.status(201).json(unidade);
  } catch {
    res.status(400).json({ error: "Erro ao criar unidade. O código já existe." });
  }
};

export const getByCodigo = async (req: AuthRequest, res: Response) => {
  const { codigo } = req.params;
  try {
    const unidade = await UnidadesService.findByCodigo(codigo);
    if (!unidade) return res.status(404).json({ error: "Unidade não encontrada" });
    res.json(unidade);
  } catch {
    res.status(500).json({ error: "Erro ao buscar unidade" });
  }
};

export const update = async (req: AuthRequest, res: Response) => {
  const { codigo } = req.params;
  const { descricao, ativo, tipo, config } = req.body;

  if (tipo && !["NACIONAL", "EXPORT"].includes(tipo))
    return res.status(400).json({ error: "tipo deve ser NACIONAL ou EXPORT" });

  try {
    const unidade = await UnidadesService.update(codigo, { descricao, ativo, tipo, config });
    res.json(unidade);
  } catch {
    res.status(400).json({ error: "Erro ao atualizar unidade." });
  }
};
