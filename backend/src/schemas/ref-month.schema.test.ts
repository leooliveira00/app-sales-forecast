import { describe, expect, it } from "vitest";
import { refMonthSchema } from "./common.schema.js";
import { cycleRefMonthParams } from "./cycle.schema.js";

describe("refMonthSchema (submissões: YYYY-MM-01)", () => {
  it.each(["2026-01-01", "2026-12-01"])("aceita %s", (v) => {
    expect(refMonthSchema.safeParse(v).success).toBe(true);
  });

  it.each(["2026-09-15", "2026-13-01", "2026-9-01", "2026-09", "2026-09-01T00:00:00.000Z", ""])("rejeita %j", (v) => {
    expect(refMonthSchema.safeParse(v).success).toBe(false);
  });
});

describe("cycleRefMonthParams (tela de ciclos: ISO completo ou YYYY-MM-01)", () => {
  it.each(["2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00Z", "2026-11-01"])("aceita %s", (refMonth) => {
    expect(cycleRefMonthParams.safeParse({ refMonth }).success).toBe(true);
  });

  it.each(["abc", "2026-11-02", "2026-11-01T03:00:00.000Z"])("rejeita %s", (refMonth) => {
    expect(cycleRefMonthParams.safeParse({ refMonth }).success).toBe(false);
  });
});
