import { describe, expect, it } from "vitest";
import { winningRunByUnitMonth, type ForecastRunMeta } from "./forecast-cycle.js";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const run = (
  id: string,
  refMonth: string,
  window: [string, string] | null,
  executedAt = refMonth,
): ForecastRunMeta => ({
  id,
  refMonth: d(refMonth),
  executedAt: d(executedAt),
  windowStart: window ? d(window[0]) : null,
  windowEnd: window ? d(window[1]) : null,
});

/** Monta os Maps de entrada: cada run aprovado para as unidades listadas. */
const input = (approvals: Record<string, ForecastRunMeta[]>) => {
  const runsByUnit = new Map<string, Set<string>>();
  const runMetaById = new Map<string, ForecastRunMeta>();
  for (const [unidade, runs] of Object.entries(approvals)) {
    runsByUnit.set(unidade, new Set(runs.map((r) => r.id)));
    for (const r of runs) runMetaById.set(r.id, r);
  }
  return [runsByUnit, runMetaById] as const;
};

describe("winningRunByUnitMonth", () => {
  it("atribui o run a todos os meses da sua janela", () => {
    const jan = run("jan", "2026-01-01", ["2026-03-01", "2026-05-01"]);

    const result = winningRunByUnitMonth(...input({ CARDIO: [jan] }));

    expect(Object.fromEntries(result)).toEqual({
      "CARDIO|2026-03": "jan",
      "CARDIO|2026-04": "jan",
      "CARDIO|2026-05": "jan",
    });
  });

  it("nos meses sobrepostos vence o ciclo de maior refMonth; os demais meses ficam com o antigo", () => {
    const jan = run("jan", "2026-01-01", ["2026-03-01", "2026-06-01"]);
    const fev = run("fev", "2026-02-01", ["2026-04-01", "2026-07-01"]);

    const result = winningRunByUnitMonth(...input({ CARDIO: [fev, jan] }));

    expect(result.get("CARDIO|2026-03")).toBe("jan");
    expect(result.get("CARDIO|2026-04")).toBe("fev");
    expect(result.get("CARDIO|2026-06")).toBe("fev");
    expect(result.get("CARDIO|2026-07")).toBe("fev");
  });

  it("independe da ordem de iteração dos runs", () => {
    const jan = run("jan", "2026-01-01", ["2026-03-01", "2026-06-01"]);
    const fev = run("fev", "2026-02-01", ["2026-04-01", "2026-07-01"]);

    const a = winningRunByUnitMonth(...input({ CARDIO: [jan, fev] }));
    const b = winningRunByUnitMonth(...input({ CARDIO: [fev, jan] }));

    expect(a).toEqual(b);
  });

  it("com mesmo refMonth, desempata pelo executedAt mais recente (reprocessamento)", () => {
    const original = run("original", "2026-02-01", ["2026-04-01", "2026-04-01"], "2026-02-05");
    const rerun = run("rerun", "2026-02-01", ["2026-04-01", "2026-04-01"], "2026-02-09");

    const result = winningRunByUnitMonth(...input({ CARDIO: [rerun, original] }));

    expect(result.get("CARDIO|2026-04")).toBe("rerun");
  });

  it("isola as unidades: um run aprovado só em uma unidade não vence na outra", () => {
    const jan = run("jan", "2026-01-01", ["2026-03-01", "2026-03-01"]);
    const fev = run("fev", "2026-02-01", ["2026-03-01", "2026-03-01"]);

    const result = winningRunByUnitMonth(...input({ CARDIO: [jan, fev], VASCULAR: [jan] }));

    expect(result.get("CARDIO|2026-03")).toBe("fev");
    expect(result.get("VASCULAR|2026-03")).toBe("jan");
  });

  it("ignora runs sem janela e runs sem metadados", () => {
    const semJanela = run("sem-janela", "2026-05-01", null);
    const [runsByUnit, runMetaById] = input({ CARDIO: [semJanela] });
    runsByUnit.get("CARDIO")!.add("run-inexistente");

    expect(winningRunByUnitMonth(runsByUnit, runMetaById).size).toBe(0);
  });

  it("atravessa a virada de ano", () => {
    const nov = run("nov", "2026-09-01", ["2026-11-01", "2027-02-01"]);

    const result = winningRunByUnitMonth(...input({ CARDIO: [nov] }));

    expect([...result.keys()]).toEqual(["CARDIO|2026-11", "CARDIO|2026-12", "CARDIO|2027-01", "CARDIO|2027-02"]);
  });

  it("normaliza windowStart no meio do mês para o primeiro dia", () => {
    const r = run("r", "2026-01-01", ["2026-03-01", "2026-04-01"]);
    r.windowStart = new Date("2026-03-15T10:00:00Z");

    const result = winningRunByUnitMonth(...input({ CARDIO: [r] }));

    expect([...result.keys()]).toEqual(["CARDIO|2026-03", "CARDIO|2026-04"]);
  });
});
