import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import { validateEnv } from "./config/env.js";
import routes from "./routes/index.js";

dotenv.config();
validateEnv();

const app = express();

// Topologia real (hml/prod): internet -> Traefik (única entrada exposta) -> nginx do
// frontend (sem porta publicada, só acessível via rede traefik-public) -> Express (sem porta
// publicada, só acessível via app-network). Ou seja, sempre exatos 2 proxies confiáveis na
// frente do Express. "true" confiaria em qualquer X-Forwarded-For informado pelo cliente
// (permitindo spoofar IP e furar o rate limiter — ver ERR_ERL_PERMISSIVE_TRUST_PROXY), então
// fixamos o número exato de hops em vez disso.
app.set("trust proxy", 2);

app.use(helmet({
  contentSecurityPolicy:     false, // ativar após validar CSP com o frontend
  crossOriginEmbedderPolicy: false, // evitar quebrar carregamento de recursos
  strictTransportSecurity:   false, // ativar somente após configurar HTTPS
}));

const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin ? { origin: corsOrigin, credentials: true } : undefined));
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.use("/api", routes);

export default app;
