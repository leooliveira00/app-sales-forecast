import "dotenv/config";
import https from "node:https";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import prisma from "../config/prisma.js";

/**
 * DRY-RUN — Reconciliação de ForecastItem de backfill contra as revisões ATUAIS do Protheus.
 *
 * Identifica "resíduo": ForecastItem criados por backfill (sourceKey='backfill-protheus')
 * cujo par (produto, unidade) NÃO é mais retornado pelo Protheus como Revisão (cTipo='R').
 * São órfãos que o delete cirúrgico janelado do backfill nunca removeu.
 *
 * NÃO APAGA NADA. Apenas gera um CSV com tudo que seria apagado, para revisão humana.
 *
 * Uso: npm run dry-run:orfaos
 */

const BACKFILL_KEY = "backfill-protheus";
// Faixa ampla e conservadora: se o produto aparece como revisão em QUALQUER mês desta
// faixa, ele NÃO é órfão. Faixa larga = menos exclusões = mais seguro.
const C_DATA_DE  = "20230101";
const C_DATA_ATE = "20281231";

interface ProtheusItem {
  data: string; classe: string; tipo: "R" | "O"; produto: string; quantidade: number; familia: string;
}

function httpsGet(url: string, auth: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search,
        headers: { Authorization: `Basic ${auth}` }, rejectUnauthorized: false },
      res => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode === 404) return resolve("__404__");
          if ((res.statusCode ?? 0) >= 400) return reject(new Error(`Protheus HTTP ${res.statusCode}`));
          resolve(Buffer.concat(chunks).toString("utf-8"));
        });
      }
    );
    req.setTimeout(60_000, () => { req.destroy(); reject(new Error("Protheus timeout")); });
    req.on("error", reject);
    req.end();
  });
}

async function fetchPrevisoes(cClasse: string, route: string, auth: string, base: string): Promise<ProtheusItem[]> {
  const itens: ProtheusItem[] = [];
  let page = 1;
  while (true) {
    const qs  = new URLSearchParams({ cClasse, cTipo: "R", cDataDe: C_DATA_DE, cDataAte: C_DATA_ATE, nPage: String(page) });
    const url = `${base}/${route}/ForecastXProtheus/listaprevisoes?${qs}`;
    const body = await httpsGet(url, auth);
    if (body === "__404__") break;
    const data = JSON.parse(body) as { metaDados: { totalPaginas: number }; itens: ProtheusItem[] };
    itens.push(...(data.itens ?? []));
    if (page >= (data.metaDados?.totalPaginas ?? 1)) break;
    page++;
  }
  return itens;
}

async function main() {
  const base = (process.env.PROTHEUS_BASE_URL ?? "").replace(/\/$/, "");
  const user = process.env.PROTHEUS_USER ?? "";
  const pass = process.env.PROTHEUS_PASSWORD ?? "";
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const routes = (process.env.PROTHEUS_ROUTES ?? "rest02").split(",").map(r => r.trim()).filter(Boolean);

  // Produtos ativos — mesmo filtro do backfill (prodsOk)
  const produtos = await prisma.produto.findMany({ select: { codigo: true } });
  const prodsOk  = new Set(produtos.map(p => p.codigo));

  // Unidades que têm forecast de backfill (só essas precisam ser reconciliadas)
  const unidadesComBackfill = await prisma.$queryRaw<{ unidadeVendaId: string; descricao: string }[]>`
    SELECT DISTINCT fi."unidadeVendaId", uv.descricao
    FROM "ForecastItem" fi
    JOIN "ForecastRun" r ON r.id = fi."runId"
    JOIN "UnidadeVenda" uv ON uv.codigo = fi."unidadeVendaId"
    WHERE r."sourceKey" = ${BACKFILL_KEY}
    ORDER BY 1
  `;

  console.log(`[dry-run] Unidades com forecast de backfill: ${unidadesComBackfill.map(u => u.unidadeVendaId).join(", ")}`);
  console.log(`[dry-run] Rotas Protheus: ${routes.join(", ")} | faixa: ${C_DATA_DE}→${C_DATA_ATE}\n`);

  // Para cada unidade, monta o conjunto de produtos VÁLIDOS (revisão atual, qtd>0, produto ativo)
  const validPorUnidade  = new Map<string, Set<string>>();
  const unidadesInconcl  = new Set<string>(); // fetch falhou/vazio → não marcar órfão (segurança)

  for (const { unidadeVendaId } of unidadesComBackfill) {
    let itens: ProtheusItem[] = [];
    let falhou = false;
    for (const route of routes) {
      try { itens.push(...await fetchPrevisoes(unidadeVendaId, route, auth, base)); }
      catch (e) { console.warn(`  WARN ${unidadeVendaId}/${route}: ${e}`); falhou = true; }
    }
    const validos = new Set(
      itens.filter(i => prodsOk.has(i.produto) && Math.round(i.quantidade) > 0).map(i => i.produto)
    );
    validPorUnidade.set(unidadeVendaId, validos);

    // Salvaguarda: se nenhuma revisão veio E houve falha de rota, é inconclusivo —
    // não vamos marcar TODOS os itens da unidade como órfãos por um erro transitório.
    if (validos.size === 0 && falhou) unidadesInconcl.add(unidadeVendaId);
    console.log(`  [${unidadeVendaId}] produtos válidos (revisão atual): ${validos.size}${unidadesInconcl.has(unidadeVendaId) ? "  ⚠ INCONCLUSIVO (fetch falhou)" : ""}`);
  }

  // Carrega todos os ForecastItem de backfill com override, run e família (do PUV)
  const items = await prisma.$queryRaw<{
    forecastItemId: string; produtoId: string; produtoDescricao: string | null;
    unidadeVendaId: string; refMonth: Date; month: Date; paisIso3: string | null;
    volumeFCTS: number | null; codigoFamilia: string | null; familia: string | null;
  }[]>`
    SELECT fi.id              AS "forecastItemId",
           fi."produtoId",
           p.descricao        AS "produtoDescricao",
           fi."unidadeVendaId",
           r."refMonth",
           fi.month,
           fi."paisIso3",
           o."volumeFCTS",
           puv."codigoFamilia",
           puv.familia
    FROM "ForecastItem" fi
    JOIN "ForecastRun" r ON r.id = fi."runId"
    LEFT JOIN "Produto" p ON p.codigo = fi."produtoId"
    LEFT JOIN "ForecastOverride" o ON o."forecastItemId" = fi.id
    LEFT JOIN "ProdutoUnidadeVenda" puv ON puv."produtoId" = fi."produtoId" AND puv."unidadeVendaId" = fi."unidadeVendaId"
    WHERE r."sourceKey" = ${BACKFILL_KEY}
  `;

  // Órfão = produto NÃO está no conjunto válido da sua unidade (e unidade não é inconclusiva)
  const orfaos = items.filter(it => {
    if (unidadesInconcl.has(it.unidadeVendaId)) return false;
    const validos = validPorUnidade.get(it.unidadeVendaId);
    if (!validos) return false;
    return !validos.has(it.produtoId);
  });

  // ── CSV ──
  const dir = join(process.env.UPLOADS_DIR ?? "uploads", "cleanup");
  mkdirSync(dir, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = join(dir, `dry-run-orfaos_${ts}.csv`);
  const fmt  = (d: Date) => d.toISOString().slice(0, 10);

  const header = "forecastItemId,produtoId,produtoDescricao,unidadeVendaId,codigoFamilia,familia,refMonth,month,paisIso3,volumeFCTS";
  const lines  = orfaos.map(o => [
    o.forecastItemId, o.produtoId, JSON.stringify(o.produtoDescricao ?? ""), o.unidadeVendaId,
    o.codigoFamilia ?? "", JSON.stringify(o.familia ?? ""), fmt(o.refMonth), fmt(o.month),
    o.paisIso3 ?? "", o.volumeFCTS ?? "",
  ].join(","));
  writeFileSync(path, [header, ...lines].join("\n"), "utf-8");

  // ── Resumo ──
  const porUnidade = new Map<string, { itens: number; produtos: Set<string> }>();
  const porFamilia = new Map<string, number>();
  for (const o of orfaos) {
    if (!porUnidade.has(o.unidadeVendaId)) porUnidade.set(o.unidadeVendaId, { itens: 0, produtos: new Set() });
    const u = porUnidade.get(o.unidadeVendaId)!; u.itens++; u.produtos.add(o.produtoId);
    const fk = `${o.codigoFamilia ?? "?"} ${o.familia ?? ""}`.trim();
    porFamilia.set(fk, (porFamilia.get(fk) ?? 0) + 1);
  }

  console.log(`\n[dry-run] ── RESUMO (NADA foi apagado) ──────────────────────`);
  console.log(`  ForecastItem de backfill no total : ${items.length}`);
  console.log(`  ForecastItem ÓRFÃOS (seriam apagados): ${orfaos.length}`);
  if (unidadesInconcl.size) console.log(`  ⚠ Unidades EXCLUÍDAS por fetch inconclusivo: ${[...unidadesInconcl].join(", ")}`);
  console.log(`\n  Por unidade:`);
  for (const [u, v] of [...porUnidade.entries()].sort((a, b) => b[1].itens - a[1].itens)) {
    console.log(`    ${u}: ${v.itens} itens | ${v.produtos.size} produtos`);
  }
  console.log(`\n  Top famílias órfãs:`);
  for (const [f, n] of [...porFamilia.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`    ${f}: ${n} itens`);
  }
  console.log(`\n[dry-run] CSV gerado em: ${path}`);
  console.log(`[dry-run] (Os ForecastOverride desses itens cairiam junto via cascade.)\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("✗ Erro:", e); await prisma.$disconnect(); process.exit(1); });
