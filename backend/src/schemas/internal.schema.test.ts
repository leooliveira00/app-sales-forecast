import { describe, expect, it } from "vitest";
import * as S from "./internal.schema.js";

/*
 * Contrato com as DAGs: os payloads abaixo reproduzem o que dags/*.py enviam hoje.
 * Se um schema passar a rejeitar algum deles, o pipeline de produção quebra.
 */

const uuid = "10e63eba-0d7e-440e-b4d6-bed60eed7e5a";

const vendaDag = (i: number) => ({
  produtoId: `P${i}`,
  unidadeVendaId: "CARDIO",
  month: "2026-08-01",
  canal: "VENDA DIRETA",
  paisIso3: null, // NaN do pandas → None → null
  quantidade: 12.0,
  receita: 1534.27,
  codigoFamilia: null,
  familia: "Cateteres",
  divisao: null,
});

const produtoProtheus = (i: number) => ({
  produto: `P${i}`,
  tipo: "PA",
  descricao: "Cateter",
  classe: "001",
  codigoFamiliaAGM: null,
  descricaoFamiliaAGM: "Cateteres",
  codigoClasseValor: "CARDIO",
  descricaoClasseValor: null,
  campoExtraDoProtheus: "x",
});

describe("contrato com as DAGs (payloads reais são aceitos)", () => {
  it.each([
    ["protheus_forecast_run: createRun", S.createForecastRunBody, { refMonth: "2026-09-01", leadTimeMonths: 2, triggeredBy: "airflow:manual__1" }],
    [
      "protheus_forecast_run: lote de 500 itens",
      S.addForecastItemsBody,
      { items: Array.from({ length: 500 }, (_, i) => ({ unidadeVendaId: "CARDIO", produtoId: `P${i}`, paisIso3: i % 2 ? null : "ARG", month: "2026-11-01", volumeIA: 42 })) },
    ],
    ["callback", S.airflowCallbackBody, { dag_id: "protheus_forecast_run", dag_run_id: "scheduled__x", state: "success", refMonth: "2026-09-01", issued_at: "2026-09-30T01:00:00Z" }],
    ["callback de vendas com dataRefMonth", S.airflowCallbackBody, { dag_id: "protheus_vendas_sync", dag_run_id: "r", state: "success", refMonth: "2026-09-01", dataRefMonth: "2026-08-01" }],
    ["protheus_cycle_reprocess: cycle-failed", S.cycleFailedBody, { refMonth: "2026-09-01" }],
    ["protheus_vendas_sync: lote com nulls", S.receiveVendasBody, { triggeredBy: "airflow:r", refMonth: "2026-08-01", cDataDe: "20260801", cDataAte: "20260831", itens: Array.from({ length: 500 }, (_, i) => vendaDag(i)) }],
    ["protheus_produtos_sync: itens crus do Protheus", S.receiveProdutosBody, { triggeredBy: "airflow:r", cTipo: "PA,PI,MP", itens: Array.from({ length: 500 }, (_, i) => produtoProtheus(i)) }],
    ["protheus_forecast_export: delete-status", S.deleteStatusBody, { logId: uuid, unidadeVendaId: "CARDIO", status: "FAILED", error: "timeout" }],
    ["protheus_forecast_export: progress", S.progressBody, { logId: uuid, unidadeVendaId: "CARDIO", month: "202611", itemIds: [uuid], status: "SUCCESS" }],
    [
      "protheus_forecast_export: finalize com isoformat() sem Z",
      S.finalizeExportBody,
      { logId: uuid, unidadesOk: 3, unidadesFailed: 1, startedAt: "2026-09-30T01:23:45.123456", details: [{ unidadeVendaId: "CARDIO", deleteStatus: "SUCCESS", meses: [] }] },
    ],
  ] as const)("%s", (_name, schema, payload) => {
    const result = schema.safeParse(payload);
    expect(result.error).toBeUndefined();
  });
});

describe("normalizações", () => {
  it("preserva campos extras dos itens do Protheus", () => {
    const { itens } = S.receiveProdutosBody.parse({ itens: [produtoProtheus(1)] });
    expect(itens[0]).toHaveProperty("campoExtraDoProtheus", "x");
  });

  it("aplica defaults de triggeredBy, cTipo e leadTimeMonths", () => {
    expect(S.createForecastRunBody.parse({ refMonth: "2026-09-01" })).toEqual({
      refMonth: "2026-09-01",
      leadTimeMonths: 2,
      triggeredBy: "airflow-scheduler",
    });
    expect(S.receiveProdutosBody.parse({ itens: [produtoProtheus(1)], cTipo: "  " }).cTipo).toBe("PA");
  });

  it("converte error: null em undefined (tipo esperado pelos serviços)", () => {
    const parsed = S.deleteStatusBody.parse({ logId: uuid, unidadeVendaId: "U", status: "SUCCESS", error: null });
    expect(parsed.error).toBeUndefined();
  });
});

describe("rejeições", () => {
  it("rejeita lote vazio e lote acima de 5000 itens", () => {
    expect(S.receiveVendasBody.safeParse({ refMonth: "2026-08-01", cDataDe: "1", cDataAte: "2", itens: [] }).success).toBe(false);
    const grande = Array.from({ length: 5001 }, (_, i) => produtoProtheus(i));
    expect(S.receiveProdutosBody.safeParse({ itens: grande }).success).toBe(false);
  });

  it("rejeita data que new Date() não interpreta", () => {
    expect(S.cycleFailedBody.safeParse({ refMonth: "ontem" }).success).toBe(false);
  });

  it("rejeita tipos errados em campos numéricos", () => {
    const item = { ...vendaDag(1), quantidade: "12" };
    expect(S.receiveVendasBody.safeParse({ refMonth: "2026-08-01", cDataDe: "1", cDataAte: "2", itens: [item] }).success).toBe(false);
  });

  it("rejeita leadTimeMonths fora de 1..24", () => {
    expect(S.createForecastRunBody.safeParse({ refMonth: "2026-09-01", leadTimeMonths: 0 }).success).toBe(false);
    expect(S.createForecastRunBody.safeParse({ refMonth: "2026-09-01", leadTimeMonths: 25 }).success).toBe(false);
  });

  it("rejeita month de export fora do formato YYYYMM", () => {
    expect(S.progressBody.safeParse({ logId: uuid, unidadeVendaId: "U", month: "2026-11", itemIds: [], status: "SUCCESS" }).success).toBe(false);
  });
});
