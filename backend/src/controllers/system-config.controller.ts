import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware.js";
import * as SystemConfigService from "../services/system-config.service.js";

export const getConfig = async (_req: AuthRequest, res: Response) => {
  try {
    const configs = await SystemConfigService.getAll();
    // Retorna como objeto chave→valor para facilitar o uso no frontend
    const map: Record<string, string> = {};
    for (const c of configs) map[c.key] = c.value;
    res.json(map);
  } catch {
    res.status(500).json({ error: "Erro ao buscar configurações" });
  }
};

export const updateConfig = async (req: AuthRequest, res: Response) => {
  const { key, value } = req.body;

  if (!key || value === undefined) {
    return res.status(400).json({ error: "key e value são obrigatórios" });
  }

  // Validações por chave conhecida
  if (key === "cycleOpenDay") {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 1 || n > 28) {
      return res.status(400).json({ error: "cycleOpenDay deve ser um número entre 1 e 28" });
    }
  }
  if (key === "cycleOpenHour") {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 0 || n > 23) {
      return res.status(400).json({ error: "cycleOpenHour deve ser um número entre 0 e 23" });
    }
  }
  if (key === "cycleCloseDay") {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 1 || n > 28) {
      return res.status(400).json({ error: "cycleCloseDay deve ser um número entre 1 e 28" });
    }
    const openDay = parseInt((await SystemConfigService.get("cycleOpenDay")) ?? "5", 10);
    if (!isNaN(openDay) && n <= openDay) {
      return res.status(400).json({ error: "cycleCloseDay deve ser maior que cycleOpenDay" });
    }
  }

  try {
    await SystemConfigService.set(key, String(value));
    res.json({ ok: true, key, value: String(value) });
  } catch {
    res.status(500).json({ error: "Erro ao salvar configuração" });
  }
};
