import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import * as ExtracaoService from "../services/extracao.service.js";

/**
 * Extração personalizada de forecast.
 *
 * O CSV vai por POST (não GET) porque os filtros são listas: nome de família
 * pode conter vírgula e a seleção de produtos chega a centenas de códigos —
 * ambos hostis a uma query string.
 */

// ── Parsing defensivo do body (sem Zod: o projeto valida na mão) ───────────────

const asStringArray = (valor: unknown): string[] | null => {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) return null;
  const limpos: string[] = [];
  for (const item of valor) {
    if (typeof item !== "string") return null;
    const texto = item.trim();
    if (texto) limpos.push(texto);
  }
  return limpos;
};

const asString = (valor: unknown): string => (typeof valor === "string" ? valor.trim() : "");

type BodyValidado = {
  startMonth: string;
  endMonth:   string;
  unidades:   string[];
  familias:   string[];
  produtos:   string[];
  metricas:   ExtracaoService.Metrica[];
  nivel:      ExtracaoService.Nivel;
};

type ValidacaoResultado =
  | { body: BodyValidado; erro: null }
  | { body: null; erro: string };

const validarBody = (raw: unknown): ValidacaoResultado => {
  if (typeof raw !== "object" || raw === null) {
    return { body: null, erro: "Corpo da requisição inválido" };
  }
  const campos: Record<string, unknown> = { ...raw };

  const startMonth = asString(campos.startMonth);
  const endMonth   = asString(campos.endMonth);

  if (!ExtracaoService.isMonth(startMonth) || !ExtracaoService.isMonth(endMonth)) {
    return { body: null, erro: "startMonth e endMonth devem estar no formato YYYY-MM" };
  }
  if (startMonth > endMonth) {
    return { body: null, erro: "startMonth não pode ser posterior a endMonth" };
  }

  const unidades = asStringArray(campos.unidades);
  const familias = asStringArray(campos.familias);
  const produtos = asStringArray(campos.produtos);
  if (!unidades || !familias || !produtos) {
    return { body: null, erro: "unidades, familias e produtos devem ser listas de texto" };
  }

  const metricasRaw = asStringArray(campos.metricas);
  if (!metricasRaw) {
    return { body: null, erro: "metricas deve ser uma lista de texto" };
  }
  const metricas = metricasRaw.filter(ExtracaoService.isMetrica);
  if (metricas.length === 0) {
    return {
      body: null,
      erro: `Selecione ao menos uma métrica válida (${ExtracaoService.METRICAS.join(", ")})`,
    };
  }

  const nivelRaw = asString(campos.nivel) || "produto";
  if (!ExtracaoService.isNivel(nivelRaw)) {
    return { body: null, erro: `nivel deve ser um de: ${ExtracaoService.NIVEIS.join(", ")}` };
  }

  return {
    body: { startMonth, endMonth, unidades, familias, produtos, metricas, nivel: nivelRaw },
    erro: null,
  };
};

// ── Handlers ──────────────────────────────────────────────────────────────────

/** Famílias, produtos e unidades que o usuário pode selecionar no modal. */
export const getFiltros = async (req: AuthRequest, res: Response) => {
  const usuario = req.user;
  if (!usuario) return res.status(401).json({ error: "Não autorizado" });

  try {
    const unidades = await ExtracaoService.resolverUnidadesAutorizadas(
      usuario.perfil,
      usuario.unidadeCodigos
    );
    const filtros = await ExtracaoService.listarFiltros(unidades);
    res.json(filtros);
  } catch (err) {
    console.error("[extracao] Falha ao listar filtros:", err);
    res.status(500).json({ error: "Erro ao carregar as opções de extração" });
  }
};

/** Gera e devolve o CSV conforme os filtros escolhidos. */
export const postCsv = async (req: AuthRequest, res: Response) => {
  const usuario = req.user;
  if (!usuario) return res.status(401).json({ error: "Não autorizado" });

  const { body, erro } = validarBody(req.body);
  if (erro || !body) return res.status(400).json({ error: erro ?? "Corpo da requisição inválido" });

  try {
    const unidades = await ExtracaoService.resolverUnidadesAutorizadas(
      usuario.perfil,
      usuario.unidadeCodigos,
      body.unidades
    );
    if (unidades.length === 0) {
      return res.status(403).json({ error: "Nenhuma unidade autorizada para os filtros informados" });
    }

    const params = {
      startMonth: body.startMonth,
      endMonth:   body.endMonth,
      unidades,
      familias:   body.familias,
      produtos:   body.produtos,
      metricas:   body.metricas,
      nivel:      body.nivel,
    };

    const linhas = await ExtracaoService.buscarLinhas(params);
    if (linhas.length === 0) {
      return res.status(404).json({ error: "Nenhum dado encontrado para os filtros selecionados" });
    }

    const csv = ExtracaoService.gerarCsv(linhas, body.metricas, body.nivel);

    // Rastro de quem levou dados de forecast para fora da ferramenta. Não usa
    // AuditLog porque `AuditEntry` restringe action/entity ao domínio de
    // forecast/submissão — ampliar aquele contrato afetaria a tela de auditoria.
    console.info(
      `[extracao] ${usuario.email} (${usuario.perfil}) extraiu ${linhas.length} linha(s) ` +
      `| ${body.startMonth}..${body.endMonth} | nível=${body.nivel} ` +
      `| unidades=${unidades.join(",")} | métricas=${body.metricas.join(",")}`
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${ExtracaoService.nomeArquivo(params)}"`
    );
    res.send(csv);
  } catch (err) {
    if (err instanceof ExtracaoService.ExtracaoMuitoGrandeError) {
      return res.status(413).json({ error: err.message });
    }
    console.error("[extracao] Falha ao gerar CSV:", err);
    res.status(500).json({ error: "Erro ao gerar a extração" });
  }
};
