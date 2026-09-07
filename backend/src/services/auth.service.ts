import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma.js";
import { logAudit } from "./audit.service.js";

// validateEnv() em app.ts garante que JWT_SECRET está definido antes de chegar aqui
const JWT_SECRET = process.env.JWT_SECRET!;

export const login = async (email: string, password: string) => {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      unidades: {
        where: { ativo: true },
        include: {
          unidadeVenda: {
            include: { paises: { where: { ativo: true }, orderBy: { nome: "asc" } } },
          },
        },
      },
    },
  });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return null;
  }

  // Atualiza lastLoginAt e registra audit em transação única.
  // Falha de auditoria não impede o login (catch interno) — preferimos um login
  // não-auditado a recusar acesso por erro de log.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await logAudit(tx, {
        userId:     user.id,
        userNome:   user.nome,
        userPerfil: user.perfil,
        source:     "user",
        action:     "LOGIN",
        entity:     "Session",
        entityId:   user.id,
        metadata:   { email: user.email },
      });
    });
  } catch (err) {
    console.error("[auth] Falha ao registrar audit de LOGIN:", err);
  }

  const unidadeCodigos = user.unidades.map((u) => u.unidadeVenda.codigo);

  const token = jwt.sign(
    { id: user.id, email: user.email, perfil: user.perfil, unidadeCodigos },
    JWT_SECRET,
    { expiresIn: "1d" }
  );

  return {
    token,
    user: {
      id: user.id,
      nome: user.nome,
      email: user.email,
      perfil: user.perfil,
      avatarUrl: user.avatarUrl ?? undefined,
      unidades: user.unidades.map((u) => ({
        id: u.id,
        role: u.role,
        unidadeVenda: {
          codigo:    u.unidadeVenda.codigo,
          descricao: u.unidadeVenda.descricao,
          tipo:      u.unidadeVenda.tipo,
          paises:    u.unidadeVenda.paises,
        },
      })),
    },
  };
};

export const logout = async (userId: string) => {
  // Busca nome/perfil para snapshot do AuditLog. Se o usuário já não existir
  // (ex.: desligado mas com token ainda válido), apenas pula o audit.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { nome: true, perfil: true },
  });
  if (!user) return;

  try {
    await prisma.$transaction((tx) =>
      logAudit(tx, {
        userId:     userId,
        userNome:   user.nome,
        userPerfil: user.perfil,
        source:     "user",
        action:     "LOGOUT",
        entity:     "Session",
        entityId:   userId,
      })
    );
  } catch (err) {
    console.error("[auth] Falha ao registrar audit de LOGOUT:", err);
  }
};
