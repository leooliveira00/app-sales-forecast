import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as ProdutosService from "../services/produtos.service.js";

export const getAll = async (req: AuthRequest, res: Response) => {
  const { unidadeVendaId, search, limit } = req.query;
  try {
    const produtos = unidadeVendaId
      ? await ProdutosService.findByUnidade(
          unidadeVendaId as string,
          search as string | undefined,
          limit ? Number(limit) : undefined
        )
      : await ProdutosService.findAll(search as string | undefined);
    res.json(produtos);
  } catch {
    res.status(500).json({ error: "Erro ao buscar produtos" });
  }
};

export const create = async (req: AuthRequest, res: Response) => {
  const { codigo, descricao, ncm } = req.body;

  if (!codigo || !descricao) {
    return res.status(400).json({ error: "Campos obrigatórios: codigo e descricao" });
  }

  try {
    const produto = await ProdutosService.create({ codigo, descricao, ncm });
    res.status(201).json(produto);
  } catch {
    res.status(400).json({ error: "Não foi possível criar o produto. Código já existe." });
  }
};

export const update = async (req: AuthRequest, res: Response) => {
  const { codigo } = req.params;
  const { descricao, ativo, ncm, classe } = req.body;

  try {
    const produto = await ProdutosService.update(codigo, { descricao, ativo, ncm, classe: classe !== undefined ? (classe || null) : undefined });
    res.json(produto);
  } catch {
    res.status(400).json({ error: "Não foi possível atualizar o produto." });
  }
};

export const linkUnidade = async (req: AuthRequest, res: Response) => {
  const { codigo } = req.params;
  const { unidadeVendaId, familia, divisao } = req.body;

  if (!unidadeVendaId) {
    return res.status(400).json({ error: "unidadeVendaId é obrigatório" });
  }

  try {
    const link = await ProdutosService.linkUnidade(codigo, unidadeVendaId, { familia, divisao });
    res.status(201).json(link);
  } catch {
    res.status(400).json({ error: "Erro ao vincular produto à unidade." });
  }
};

export const updateUnidadeLink = async (req: AuthRequest, res: Response) => {
  const { codigo, unidadeVendaId } = req.params;
  const { familia, divisao } = req.body;

  try {
    const link = await ProdutosService.updateLink(codigo, unidadeVendaId, {
      familia: familia !== undefined ? (familia || null) : undefined,
      divisao: divisao !== undefined ? (divisao || null) : undefined,
    });
    res.json(link);
  } catch {
    res.status(400).json({ error: "Erro ao atualizar vínculo." });
  }
};

export const unlinkUnidade = async (req: AuthRequest, res: Response) => {
  const { codigo, unidadeVendaId } = req.params;
  try {
    await ProdutosService.unlinkUnidade(codigo, unidadeVendaId);
    res.status(204).send();
  } catch {
    res.status(400).json({ error: "Erro ao desvincular produto da unidade." });
  }
};

export const remove = async (req: AuthRequest, res: Response) => {
  const { codigo } = req.params;
  try {
    await ProdutosService.softDelete(codigo);
    res.status(204).send();
  } catch {
    res.status(400).json({ error: "Não foi possível remover o produto." });
  }
};
