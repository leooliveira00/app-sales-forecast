import prisma from "../config/prisma.js";

export const createForRole = async (
  perfil: string,
  type: string,
  title: string,
  body: string,
  refMonth?: Date | string
) => {
  const users = await prisma.user.findMany({
    where: { perfil: perfil as any },
    select: { id: true },
  });

  if (users.length === 0) return [];

  const refDate = refMonth ? new Date(refMonth) : undefined;

  return prisma.notification.createMany({
    data: users.map((u) => ({
      userId:   u.id,
      type,
      title,
      body,
      refMonth: refDate,
    })),
  });
};

export const createForUser = async (
  userId: string,
  type: string,
  title: string,
  body: string,
  refMonth?: Date | string
) => {
  return prisma.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      refMonth: refMonth ? new Date(refMonth) : undefined,
    },
  });
};

export const getUnreadCount = async (userId: string) => {
  return prisma.notification.count({
    where: { userId, readAt: null },
  });
};

export const listForUser = async (userId: string, limit = 30) => {
  return prisma.notification.findMany({
    where:   { userId },
    orderBy: { createdAt: "desc" },
    take:    limit,
  });
};

export const markRead = async (notificationId: string, userId: string) => {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data:  { readAt: new Date() },
  });
};

export const markAllRead = async (userId: string) => {
  return prisma.notification.updateMany({
    where: { userId, readAt: null },
    data:  { readAt: new Date() },
  });
};
