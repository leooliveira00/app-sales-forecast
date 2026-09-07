import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as NotificationService from "../services/notification.service.js";

export const unreadCount = async (req: AuthRequest, res: Response) => {
  try {
    const count = await NotificationService.getUnreadCount(req.user!.id);
    res.json({ count });
  } catch {
    res.status(500).json({ error: "Erro ao buscar contagem de notificações" });
  }
};

export const list = async (req: AuthRequest, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 30;
  try {
    const notifications = await NotificationService.listForUser(req.user!.id, limit);
    res.json(notifications);
  } catch {
    res.status(500).json({ error: "Erro ao buscar notificações" });
  }
};

export const markRead = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await NotificationService.markRead(id, req.user!.id);
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Erro ao marcar notificação como lida" });
  }
};

export const markAllRead = async (req: AuthRequest, res: Response) => {
  try {
    await NotificationService.markAllRead(req.user!.id);
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Erro ao marcar notificações como lidas" });
  }
};
