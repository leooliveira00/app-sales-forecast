/**
 * Análise de desvio: CSV bruto Protheus vs VendaMensal no banco (2026)
 * Unidades: 3103001, 3101001
 *
 * Uso:
 *   cd backend
 *   npx tsx src/scripts/analise-desvio-vendas.ts
 */

import fs   from "fs";
import path from "path";

// ── Configuração ──────────────────────────────────────────────────────────────

const UNIDADES = ["3101001", "3103001"];
const MESES    = ["2026-01", "2026-02", "2026-03", "2026-04"];

// Blacklist da DAG (hardcoded no código Python)
const CLASSE_VALOR_EXCLUIDOS = new Set(["3202001", "3201002"]);

// Whitelist real do Airflow (VENDAS_CFOP_PERMITIDOS)
const CFOPS_PERMITIDOS = new Set([
  "1201","1202","2201","2202","2203","2204","3201",
  "5101","5102","5106","5113","5114","5922",
  "6101","6102","6105","6107","6108","6109","6110","6113","6114","6922",
  "7101","7102",
]);

// Dados do banco — resultado da query SQL (jan–abr 2026)
const DB_ROWS = [
  { unidade: "3101001", mes: "2026-01", qtdDb:  8269, linhasDb: 272 },
  { unidade: "3101001", mes: "2026-02", qtdDb:  6506, linhasDb: 293 },
  { unidade: "3101001", mes: "2026-03", qtdDb:  9151, linhasDb: 317 },
  { unidade: "3101001", mes: "2026-04", qtdDb:  5953, linhasDb: 258 },
  { unidade: "3103001", mes: "2026-01", qtdDb:  1537, linhasDb: 190 },
  { unidade: "3103001", mes: "2026-02", qtdDb:  1971, linhasDb: 207 },
  { unidade: "3103001", mes: "2026-03", qtdDb:  2689, linhasDb: 250 },
  { unidade: "3103001", mes: "2026-04", qtdDb:  2509, linhasDb: 212 },
];

const DB_TOTAL = DB_ROWS.reduce((s, r) => s + r.qtdDb, 0);

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCsv(filePath: string): Record<string, string>[] {
  const lines  = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const vals: string[] = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { vals.push(cur); cur = ""; continue; }
      cur += ch;
    }
    vals.push(cur);
    return Object.fromEntries(header.map((h, i) => [h, vals[i] ?? ""]));
  });
}

function toMes(emissaoNF: string): string {
  return `${emissaoNF.slice(0, 4)}-${emissaoNF.slice(4, 6)}`;
}

function key(unidade: string, mes: string) { return `${unidade}|${mes}`; }

function sep(w = 112) { return "─".repeat(w); }

function pct(num: number, den: number, sign = false): string {
  if (den === 0) return "N/A";
  const v = ((num / den) * 100).toFixed(1);
  return sign && num > 0 ? `+${v}%` : `${v}%`;
}

type BucketMap = Map<string, { qtd: number; linhas: number }>;

function agregar(rows: Record<string, string>[]): BucketMap {
  const m: BucketMap = new Map();
  for (const r of rows) {
    const k = key(r.codigoClasseValor.trim(), toMes(r.emissaoNF));
    const b = m.get(k) ?? { qtd: 0, linhas: 0 };
    b.qtd    += Number(r.quantidade) || 0;
    b.linhas += 1;
    m.set(k, b);
  }
  return m;
}

// ── main ──────────────────────────────────────────────────────────────────────

const csvPath = process.env.CSV
  ?? path.resolve("/home/suporte/vendas_auditoria_2026-05-07T11-40-28.csv");

console.log(`\nLendo CSV: ${csvPath}`);
const todos = parseCsv(csvPath);
console.log(`Total de linhas no CSV: ${todos.length}`);

// ── Pipeline ETL em etapas (replica a DAG) ────────────────────────────────────

// Etapa 0: bruto das unidades alvo
const e0_bruto = todos.filter((r) => UNIDADES.includes(r.codigoClasseValor?.trim()));

// Etapa 1: whitelist CFOP
const e1_cfop = e0_bruto.filter((r) => CFOPS_PERMITIDOS.has(r.cfop?.trim()));

// Etapa 2: blacklist codigoClasseValor
const e2_blacklist = e1_cfop.filter((r) => !CLASSE_VALOR_EXCLUIDOS.has(r.codigoClasseValor?.trim()));

// Etapa 3: a DAG agrega por (produto, unidade, mês, canal, paisIso3) e descarta grupos <= 0
// Aqui simulamos o descarte de linhas individuais com qtd <= 0 (conservador — o real é por grupo)
const e3_negRaw     = e2_blacklist.filter((r) => (Number(r.quantidade) || 0) <= 0);

// Etapa 3b: simular agregação por grupo e descartar grupos com líquido <= 0
type GKey = string;
interface GVal { qtd: number; rows: Record<string, string>[] }
const grupos = new Map<GKey, GVal>();
for (const r of e2_blacklist) {
  const gk = [
    r.codigoProduto?.trim(),
    r.codigoClasseValor?.trim(),
    toMes(r.emissaoNF),
    r.canal?.trim(),
    r.pais?.trim().toUpperCase() || "NULL",
  ].join("|");
  const g = grupos.get(gk) ?? { qtd: 0, rows: [] };
  g.qtd += Number(r.quantidade) || 0;
  g.rows.push(r);
  grupos.set(gk, g);
}

// Grupos positivos (o que vai para o banco)
let e4_qtdPos = 0, e4_linhas = 0, e4_descGrupos = 0, e4_qtdDescGrupos = 0;
for (const [, g] of grupos) {
  if (g.qtd > 0) { e4_qtdPos += g.qtd; e4_linhas += g.rows.length; }
  else { e4_descGrupos++; e4_qtdDescGrupos += g.qtd; }
}

// Totais por etapa
const qtd = (rows: Record<string, string>[]) => rows.reduce((s, r) => s + (Number(r.quantidade)||0), 0);

// ── Saída ─────────────────────────────────────────────────────────────────────

console.log(`\n${sep()}`);
console.log("1. FUNIL ETL — replicando pipeline da DAG (jan–abr 2026, unidades alvo)");
console.log(sep());
console.log(`  ${"Etapa".padEnd(55)} ${"Linhas".padStart(8)} ${"Qtd total".padStart(12)} ${"Descartado".padStart(12)}`);
console.log(`  ${sep(90)}`);

const funil: [string, number, number][] = [
  ["0. Bruto CSV (unidades 3101001 + 3103001)",        e0_bruto.length,    qtd(e0_bruto)],
  ["1. Após whitelist CFOP",                           e1_cfop.length,     qtd(e1_cfop)],
  ["2. Após blacklist codigoClasseValor",              e2_blacklist.length, qtd(e2_blacklist)],
  ["3. Grupos (produto×unid×mês×canal×país) líq > 0", e4_linhas,          e4_qtdPos],
  ["4. Banco DB (VendaMensal)",                        DB_ROWS.reduce((s,r)=>s+r.linhasDb,0), DB_TOTAL],
];
let prevQtd = qtd(e0_bruto);
for (const [label, linhas, q] of funil) {
  const disc = prevQtd - q;
  const discStr = label.startsWith("0") ? "" : (disc !== 0 ? String(disc) : "—");
  console.log(`  ${label.padEnd(55)} ${String(linhas).padStart(8)} ${String(q).padStart(12)} ${discStr.padStart(12)}`);
  prevQtd = q;
}

console.log(`\n  Bruto CSV:              ${qtd(e0_bruto).toLocaleString("pt-BR")}`);
console.log(`  Após filtro CFOP:       ${qtd(e1_cfop).toLocaleString("pt-BR")}  (−${(qtd(e0_bruto)-qtd(e1_cfop)).toLocaleString("pt-BR")} descartados)`);
console.log(`  Após agregação (sim.):  ${e4_qtdPos.toLocaleString("pt-BR")}`);
console.log(`  Banco DB:               ${DB_TOTAL.toLocaleString("pt-BR")}`);
console.log(`  Gap simulado → banco:   ${(e4_qtdPos - DB_TOTAL).toLocaleString("pt-BR")} (${pct(e4_qtdPos - DB_TOTAL, DB_TOTAL, true)})`);

// ── Por unidade/mês ───────────────────────────────────────────────────────────

const mBruto  = agregar(e0_bruto);
const mCfop   = agregar(e1_cfop);

console.log(`\n${sep()}`);
console.log("2. DESVIO POR UNIDADE / MÊS");
console.log(sep());
console.log(
  `  ${"Unidade".padEnd(10)} ${"Mês".padEnd(8)} ` +
  `${"Bruto".padStart(8)} ${"Após CFOP".padStart(10)} ${"Banco DB".padStart(9)} ` +
  `${"Desvio Bruto".padStart(14)} ${"Desvio pós-CFOP".padStart(16)}`
);
console.log(`  ${sep(90)}`);

for (const unidade of UNIDADES) {
  for (const mes of MESES) {
    const k     = key(unidade, mes);
    const qB    = mBruto.get(k)?.qtd ?? 0;
    const qC    = mCfop.get(k)?.qtd  ?? 0;
    const dbRow = DB_ROWS.find((d) => d.unidade === unidade && d.mes === mes);
    const qDb   = dbRow?.qtdDb ?? 0;
    console.log(
      `  ${unidade.padEnd(10)} ${mes.padEnd(8)} ` +
      `${String(qB).padStart(8)} ${String(qC).padStart(10)} ${String(qDb).padStart(9)} ` +
      `${pct(qB - qDb, qDb, true).padStart(14)} ${pct(qC - qDb, qDb, true).padStart(16)}`
    );
  }
}

// ── CFOPs descartados ─────────────────────────────────────────────────────────

console.log(`\n${sep()}`);
console.log("3. CFOPs PRESENTES NO CSV MAS FORA DA WHITELIST — volume descartado");
console.log(sep());

const cfopDescartado = new Map<string, { qtd: number; linhas: number; unidades: Set<string> }>();
for (const r of e0_bruto) {
  const cfop = r.cfop?.trim() || "(vazio)";
  if (!CFOPS_PERMITIDOS.has(cfop)) {
    const b = cfopDescartado.get(cfop) ?? { qtd: 0, linhas: 0, unidades: new Set() };
    b.qtd    += Number(r.quantidade) || 0;
    b.linhas += 1;
    b.unidades.add(r.codigoClasseValor.trim());
    cfopDescartado.set(cfop, b);
  }
}

if (cfopDescartado.size === 0) {
  console.log("  Nenhum CFOP fora da whitelist encontrado nas unidades alvo.");
} else {
  console.log(`  ${"CFOP".padEnd(8)} ${"Linhas".padStart(7)} ${"Qtd".padStart(10)} ${"% do bruto".padStart(11)}   Unidades`);
  console.log(`  ${sep(70)}`);
  const sorted = [...cfopDescartado.entries()].sort((a, b) => Math.abs(b[1].qtd) - Math.abs(a[1].qtd));
  for (const [cfop, b] of sorted) {
    console.log(
      `  ${cfop.padEnd(8)} ${String(b.linhas).padStart(7)} ${String(b.qtd).padStart(10)} ` +
      `${pct(b.qtd, qtd(e0_bruto)).padStart(11)}   ${[...b.unidades].join(", ")}`
    );
  }
  const totDisc = [...cfopDescartado.values()].reduce((s, b) => s + b.qtd, 0);
  const totLin  = [...cfopDescartado.values()].reduce((s, b) => s + b.linhas, 0);
  console.log(`\n  Total descartado pelo filtro CFOP: ${totLin} linhas | ${totDisc.toLocaleString("pt-BR")} unidades`);
}

// ── Todos os CFOPs por volume ─────────────────────────────────────────────────

console.log(`\n${sep()}`);
console.log("4. TODOS OS CFOPs NAS UNIDADES ALVO — breakdown por volume (ordenado por qtd desc)");
console.log(sep());
console.log(`  ${"CFOP".padEnd(8)} ${"Whitelist".padStart(10)} ${"Linhas".padStart(7)} ${"Qtd>0".padStart(8)} ${"Qtd<=0".padStart(8)} ${"Líquido".padStart(9)} ${"% bruto".padStart(9)}   Unidades`);
console.log(`  ${sep(90)}`);

const cfopAll = new Map<string, { qtdPos: number; qtdNeg: number; linhas: number; unidades: Set<string> }>();
for (const r of e0_bruto) {
  const cfop = r.cfop?.trim() || "(vazio)";
  const qtdV = Number(r.quantidade) || 0;
  const b = cfopAll.get(cfop) ?? { qtdPos: 0, qtdNeg: 0, linhas: 0, unidades: new Set() };
  b.linhas++;
  if (qtdV > 0) b.qtdPos += qtdV; else b.qtdNeg += qtdV;
  b.unidades.add(r.codigoClasseValor.trim());
  cfopAll.set(cfop, b);
}

const cfopAllSorted = [...cfopAll.entries()].sort((a, b) => b[1].qtdPos - a[1].qtdPos);
for (const [cfop, b] of cfopAllSorted) {
  const liq  = b.qtdPos + b.qtdNeg;
  const wl   = CFOPS_PERMITIDOS.has(cfop) ? "✓" : "✗ FORA";
  console.log(
    `  ${cfop.padEnd(8)} ${wl.padStart(10)} ${String(b.linhas).padStart(7)} ` +
    `${String(b.qtdPos).padStart(8)} ${String(b.qtdNeg).padStart(8)} ${String(liq).padStart(9)} ` +
    `${pct(liq, qtd(e0_bruto)).padStart(9)}   ${[...b.unidades].join(", ")}`
  );
}

// ── Devoluções por unidade/mês ────────────────────────────────────────────────

console.log(`\n${sep()}`);
console.log("5. DEVOLUÇÕES (qtd <= 0) APÓS FILTRO CFOP — impacto na agregação");
console.log(sep());

const negMap = new Map<string, { qtd: number; linhas: number; cfops: Set<string> }>();
for (const r of e3_negRaw) {
  const k = key(r.codigoClasseValor.trim(), toMes(r.emissaoNF));
  const b = negMap.get(k) ?? { qtd: 0, linhas: 0, cfops: new Set() };
  b.qtd    += Number(r.quantidade) || 0;
  b.linhas += 1;
  b.cfops.add(r.cfop?.trim() || "(vazio)");
  negMap.set(k, b);
}

if (negMap.size === 0) {
  console.log("  Nenhuma devolução após filtro CFOP.");
} else {
  console.log(`  ${"Unidade".padEnd(10)} ${"Mês".padEnd(8)} ${"Linhas".padStart(7)} ${"Qtd negativa".padStart(13)} ${"% do DB".padStart(9)}   CFOPs`);
  console.log(`  ${sep(80)}`);
  for (const [k, b] of [...negMap.entries()].sort()) {
    const [unidade, mes] = k.split("|");
    const qDb = DB_ROWS.find((d) => d.unidade === unidade && d.mes === mes)?.qtdDb ?? 0;
    console.log(
      `  ${unidade.padEnd(10)} ${mes.padEnd(8)} ${String(b.linhas).padStart(7)} ` +
      `${String(b.qtd).padStart(13)} ${pct(Math.abs(b.qtd), qDb).padStart(9)}   ${[...b.cfops].sort().join(", ")}`
    );
  }
  const totNegQtd = [...negMap.values()].reduce((s, b) => s + b.qtd, 0);
  console.log(`\n  Total devoluções pós-CFOP: ${totNegQtd.toLocaleString("pt-BR")} unidades`);
}

// ── Grupos descartados na agregação ───────────────────────────────────────────

if (e4_descGrupos > 0) {
  console.log(`\n${sep()}`);
  console.log("6. GRUPOS DESCARTADOS NA AGREGAÇÃO (líquido <= 0 após somar qtd do grupo)");
  console.log(sep());
  console.log(`  Grupos descartados : ${e4_descGrupos}`);
  console.log(`  Qtd líquida negativa descartada: ${e4_qtdDescGrupos.toLocaleString("pt-BR")}`);
  console.log(`  (Esses grupos têm mais devoluções do que vendas no mesmo produto×unidade×mês×canal×país)`);
}

// ── Resumo executivo ──────────────────────────────────────────────────────────

console.log(`\n${sep()}`);
console.log("RESUMO EXECUTIVO");
console.log(sep());

for (const unidade of UNIDADES) {
  const rows = DB_ROWS.filter((d) => d.unidade === unidade);
  const qDbU = rows.reduce((s, r) => s + r.qtdDb, 0);

  const qBrutoU = MESES.reduce((s, m) => s + (mBruto.get(key(unidade, m))?.qtd ?? 0), 0);
  const qCfopU  = MESES.reduce((s, m) => s + (mCfop.get(key(unidade, m))?.qtd  ?? 0), 0);
  const discCfopU = qBrutoU - qCfopU;

  console.log(`\n  Unidade ${unidade}:`);
  console.log(`    Bruto CSV (jan–abr)     : ${qBrutoU.toLocaleString("pt-BR").padStart(8)}`);
  console.log(`    Descartado p/ CFOP      : ${discCfopU.toLocaleString("pt-BR").padStart(8)}  (${pct(discCfopU, qBrutoU)})`);
  console.log(`    Após filtro CFOP        : ${qCfopU.toLocaleString("pt-BR").padStart(8)}`);
  console.log(`    Banco DB                : ${qDbU.toLocaleString("pt-BR").padStart(8)}`);
  console.log(`    Gap pós-CFOP → banco    : ${(qCfopU - qDbU).toLocaleString("pt-BR").padStart(8)}  (${pct(qCfopU - qDbU, qDbU, true)})`);
}

console.log(`\n  Causa mais provável do gap residual (pós-CFOP):`);
console.log(`    • Devoluções (qtd<=0) que são somadas na agregação por grupo`);
console.log(`      cancelando vendas positivas → reduz o líquido enviado ao banco.`);
console.log(`    • Grupos cujo líquido ficou <= 0 são descartados inteiramente.`);
console.log(`    • Verificar se todos os meses foram sincronizados (log VendasSyncLog).`);

console.log(`\n${sep()}\n`);
