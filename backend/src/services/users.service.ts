import bcrypt from "bcryptjs";
import { Perfil, UserUnidadeRole } from "@prisma/client";
import prisma from "../config/prisma.js";

const includeUnidades = {
  unidades: {
    where: { ativo: true },
    include: { unidadeVenda: true },
  },
};

// Campos seguros para exposição via API. Exclui `password` (hash bcrypt).
const safeUserSelect = {
  id:          true,
  email:       true,
  nome:        true,
  perfil:      true,
  avatarUrl:   true,
  lastLoginAt: true,
  createdAt:   true,
  updatedAt:   true,
  unidades: {
    where:   { ativo: true },
    include: { unidadeVenda: true },
  },
};

export const findAll = async () => {
  return prisma.user.findMany({
    select:  safeUserSelect,
    orderBy: { nome: "asc" },
  });
};

export const create = async (data: {
  email: string;
  password: string;
  nome: string;
  perfil: string;
  unidadeVendaId?: string;
  role?: string;
}) => {
  const hashedPassword = await bcrypt.hash(data.password, 10);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      password: hashedPassword,
      nome: data.nome,
      perfil: data.perfil as Perfil,
      ...(data.unidadeVendaId && {
        unidades: {
          create: {
            unidadeVendaId: data.unidadeVendaId,
            role: (data.role ?? "GESTOR") as UserUnidadeRole,
          },
        },
      }),
    },
    include: includeUnidades,
  });

  return user;
};

export const addUnidade = async (userId: string, unidadeVendaId: string, role: string) => {
  return prisma.userUnidadeVenda.create({
    data: {
      userId,
      unidadeVendaId,
      role: role as UserUnidadeRole,
    },
    include: { unidadeVenda: true },
  });
};

export const removeUnidade = async (userId: string, unidadeVendaId: string) => {
  return prisma.userUnidadeVenda.deleteMany({
    where: { userId, unidadeVendaId },
  });
};

export const update = async (
  id: string,
  data: { nome?: string; email?: string; perfil?: string; novaSenha?: string }
) => {
  const updateData: Record<string, unknown> = {};
  if (data.nome)     updateData.nome   = data.nome;
  if (data.email)    updateData.email  = data.email;
  if (data.perfil)   updateData.perfil = data.perfil as Perfil;
  if (data.novaSenha) {
    const bcrypt = await import("bcryptjs");
    updateData.password = await bcrypt.hash(data.novaSenha, 10);
  }
  return prisma.user.update({ where: { id }, data: updateData, include: includeUnidades });
};

export const updateAvatar = async (id: string, avatarUrl: string) => {
  return prisma.user.update({
    where: { id },
    data: { avatarUrl },
    select: { id: true, avatarUrl: true },
  });
};

export const removeAvatar = async (id: string) => {
  return prisma.user.update({
    where: { id },
    data: { avatarUrl: null },
    select: { id: true, avatarUrl: true },
  });
};

export const findById = async (id: string) => {
  return prisma.user.findUnique({ where: { id }, select: { avatarUrl: true } });
};

export const remove = async (id: string) => {
  return prisma.user.delete({ where: { id } });
};
