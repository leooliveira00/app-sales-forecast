import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { AuthRequest, authenticate } from "../middleware/auth.middleware.js";

// validateEnv() em app.ts garante que JWT_SECRET está definido antes de chegar aqui
const JWT_SECRET = process.env.JWT_SECRET!;
const TREINAMENTOS_DIR = path.join(process.cwd(), "uploads", "treinamentos");

// Whitelist de vídeos disponíveis (slug → arquivo). Evita path traversal e
// é a fonte de verdade dos slugs válidos (deve casar com o catálogo do front).
const VIDEOS: Record<string, string> = {
  "introducao":   "introducao.mp4",
  "dashboard":    "dashboard.mp4",
  "meu-forecast": "meu-forecast.mp4",
  "consolidado":  "consolidado.mp4",
};

interface VideoTicket { slug: string; kind: "video" }

const router = Router();

/**
 * GET /api/treinamentos/:slug/ticket  (autenticado por JWT no header)
 * Emite um ticket curto, escopado a este vídeo. Necessário porque a tag
 * <video> não envia o cabeçalho Authorization — o ticket vai na query da mídia.
 */
router.get("/:slug/ticket", authenticate, (req: AuthRequest, res: Response) => {
  const { slug } = req.params;
  if (!VIDEOS[slug]) return res.status(404).json({ error: "Vídeo não encontrado" });
  const token = jwt.sign({ slug, kind: "video" } as VideoTicket, JWT_SECRET, { expiresIn: "2h" });
  res.json({ token });
});

/**
 * GET /api/treinamentos/:slug?ticket=<token>
 * Faz streaming do vídeo. Range/seek é tratado automaticamente pelo res.sendFile.
 * Valida o ticket assinado (não o JWT da sessão) — mantém o vídeo atrás do login
 * sem expor o token de sessão na URL.
 */
router.get("/:slug", (req: Request, res: Response) => {
  const { slug } = req.params;
  const ticket   = req.query.ticket;
  const filename = VIDEOS[slug];

  if (!filename) return res.status(404).json({ error: "Vídeo não encontrado" });
  if (typeof ticket !== "string") return res.status(401).json({ error: "Ticket ausente" });

  try {
    const decoded = jwt.verify(ticket, JWT_SECRET) as VideoTicket;
    if (decoded.kind !== "video" || decoded.slug !== slug) {
      return res.status(403).json({ error: "Ticket inválido" });
    }
  } catch {
    return res.status(401).json({ error: "Ticket inválido ou expirado" });
  }

  const filePath = path.join(TREINAMENTOS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Arquivo não disponível" });

  res.sendFile(filePath, {
    headers: { "Content-Type": "video/mp4", "Cache-Control": "private, max-age=3600" },
  });
});

export default router;
