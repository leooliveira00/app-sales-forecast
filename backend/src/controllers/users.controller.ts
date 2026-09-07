import { Response } from "express";
import path from "path";
import fs from "fs";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as UsersService from "../services/users.service.js";
import { ALL_ROLES, ADMIN_ROLES } from "../constants/roles.js";

/**
 * Valida o perfil contra `ROLES` (constants/roles.ts), única fonte da lista.
 * Havia dois arrays literais aqui, e ambos ficaram para trás quando o perfil
 * `consulta` foi criado — a tela devolvia 400 ao atribuí-lo.
 */
const isPerfilValido = (valor: unknown): boolean =>
  typeof valor === "string" && ALL_ROLES.some((r) => r === valor);


export const getAll = async (_req: AuthRequest, res: Response) => {
  try {
    const users = await UsersService.findAll();
    res.json(users);
  } catch {
    res.status(500).json({ error: "Erro ao buscar usuários" });
  }
};

export const create = async (req: AuthRequest, res: Response) => {
  const { email, password, nome, perfil, unidadeVendaId, role } = req.body;

  if (!email || !password || !nome || !perfil) {
    return res.status(400).json({ error: "Campos obrigatórios: email, senha, nome e perfil" });
  }

  if (!isPerfilValido(perfil)) {
    return res.status(400).json({ error: `Perfil inválido. Use: ${ALL_ROLES.join(", ")}` });
  }

  try {
    const user = await UsersService.create({ email, password, nome, perfil, unidadeVendaId, role });
    res.status(201).json(user);
  } catch {
    res.status(400).json({ error: "Erro ao criar usuário. Verifique se o e-mail já está em uso." });
  }
};

export const addUnidade = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { unidadeVendaId, role } = req.body;

  if (!unidadeVendaId) {
    return res.status(400).json({ error: "unidadeVendaId é obrigatório" });
  }

  try {
    const link = await UsersService.addUnidade(id, unidadeVendaId, role ?? "GESTOR");
    res.status(201).json(link);
  } catch {
    res.status(400).json({ error: "Erro ao vincular unidade. Vínculo já pode existir." });
  }
};

export const removeUnidade = async (req: AuthRequest, res: Response) => {
  const { id, unidadeVendaId } = req.params;
  try {
    await UsersService.removeUnidade(id, unidadeVendaId);
    res.status(204).send();
  } catch {
    res.status(400).json({ error: "Erro ao remover vínculo com unidade." });
  }
};

export const update = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { nome, email, perfil, novaSenha } = req.body;

  if (perfil) {
    if (!isPerfilValido(perfil)) {
      return res.status(400).json({ error: `Perfil inválido. Use: ${ALL_ROLES.join(", ")}` });
    }
  }

  try {
    const user = await UsersService.update(id, { nome, email, perfil, novaSenha });
    res.json(user);
  } catch (err) {
    // O catch silencioso daqui atribuía qualquer falha a "e-mail em uso" — o que
    // esconde a causa real. O caso concreto: perfil válido no código mas ausente
    // do enum no banco (migration não aplicada) devolvia a mensagem errada.
    console.error(`[users] Falha ao atualizar ${id}:`, err);
    const detalhe = err instanceof Error ? err.message : String(err);

    if (detalhe.includes("Unique constraint") || detalhe.includes("P2002")) {
      return res.status(409).json({ error: "E-mail já está em uso por outro usuário." });
    }
    if (detalhe.includes("invalid input value for enum")) {
      return res.status(500).json({
        error:
          "Perfil não reconhecido pelo banco de dados. A migration que adiciona o perfil " +
          "provavelmente não foi aplicada neste ambiente.",
      });
    }
    res.status(400).json({ error: "Erro ao atualizar usuário." });
  }
};



const canManageAvatar = (req: AuthRequest, targetId: string) =>
  req.user?.id === targetId || ADMIN_ROLES.some((r) => r === (req.user?.perfil ?? ""));

export const uploadAvatar = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!canManageAvatar(req, id)) {
    return res.status(403).json({ error: "Sem permissão para alterar este avatar." });
  }

  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado." });
  }

  try {
    // Remove arquivo antigo se existir
    const existing = await UsersService.findById(id);
    if (existing?.avatarUrl) {
      const oldPath = path.join(process.cwd(), existing.avatarUrl.replace(/^\//, ""));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    await UsersService.updateAvatar(id, avatarUrl);
    res.json({ avatarUrl });
  } catch {
    res.status(500).json({ error: "Erro ao salvar avatar." });
  }
};

export const deleteAvatar = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!canManageAvatar(req, id)) {
    return res.status(403).json({ error: "Sem permissão para remover este avatar." });
  }

  try {
    const existing = await UsersService.findById(id);
    if (existing?.avatarUrl) {
      const filePath = path.join(process.cwd(), existing.avatarUrl.replace(/^\//, ""));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await UsersService.removeAvatar(id);
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Erro ao remover avatar." });
  }
};

export const remove = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (id === req.user?.id) {
    return res.status(400).json({ error: "Você não pode excluir a si mesmo." });
  }

  try {
    await UsersService.remove(id);
    res.status(204).send();
  } catch {
    res.status(400).json({ error: "Erro ao excluir usuário." });
  }
};
