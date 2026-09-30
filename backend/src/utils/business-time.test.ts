import { describe, expect, it } from "vitest";
import { businessDayAt, endOfBusinessDay, nextBusinessTimeAt } from "./business-time.js";

// America/Sao_Paulo é UTC-3 o ano todo desde 2019 (sem horário de verão).

describe("businessDayAt", () => {
  it("converte horário de Brasília para o instante UTC", () => {
    expect(businessDayAt(2026, 7, 10, 8).toISOString()).toBe("2026-08-10T11:00:00.000Z");
  });

  it("meia-noite em Brasília cai às 03h UTC do mesmo dia", () => {
    expect(businessDayAt(2026, 0, 1).toISOString()).toBe("2026-01-01T03:00:00.000Z");
  });

  it("normaliza dia fora do mês como Date.UTC (32/jan → 01/fev)", () => {
    expect(businessDayAt(2026, 0, 32, 8).toISOString()).toBe("2026-02-01T11:00:00.000Z");
  });
});

describe("endOfBusinessDay", () => {
  it("fechamento às 23:59:59 de Brasília cai no dia seguinte em UTC", () => {
    // Regressão: gravar Date.UTC(..., 28, 23, 59, 59) fechava o ciclo às 20:59 BRT.
    expect(endOfBusinessDay(2026, 6, 28).toISOString()).toBe("2026-07-29T02:59:59.000Z");
  });
});

describe("nextBusinessTimeAt", () => {
  it("antes do horário de abertura, abre no mesmo dia", () => {
    const from = new Date("2026-08-11T10:00:00Z"); // 07:00 BRT
    expect(nextBusinessTimeAt(from, 8).toISOString()).toBe("2026-08-11T11:00:00.000Z");
  });

  it("depois do horário de abertura, espera o dia seguinte", () => {
    const from = new Date("2026-08-11T16:32:00Z"); // 13:32 BRT
    expect(nextBusinessTimeAt(from, 8).toISOString()).toBe("2026-08-12T11:00:00.000Z");
  });

  it("exatamente no horário, abre na hora", () => {
    const from = new Date("2026-08-11T11:00:00Z"); // 08:00 BRT
    expect(nextBusinessTimeAt(from, 8).toISOString()).toBe("2026-08-11T11:00:00.000Z");
  });

  it("usa o dia civil de Brasília, não o de UTC", () => {
    // 01:00 UTC de 12/08 ainda é 22:00 de 11/08 em Brasília → próxima abertura 12/08 08:00 BRT.
    const from = new Date("2026-08-12T01:00:00Z");
    expect(nextBusinessTimeAt(from, 8).toISOString()).toBe("2026-08-12T11:00:00.000Z");
  });

  it("vira o mês corretamente", () => {
    const from = new Date("2026-08-31T20:00:00Z"); // 17:00 BRT de 31/08
    expect(nextBusinessTimeAt(from, 8).toISOString()).toBe("2026-09-01T11:00:00.000Z");
  });
});
