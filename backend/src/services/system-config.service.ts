import prisma from "../config/prisma.js";

const DEFAULT_CYCLE_OPEN_DAY  = 5;
/** Hora de liberação do ciclo aos gestores, no fuso de negócio (America/Sao_Paulo). */
const DEFAULT_CYCLE_OPEN_HOUR = 8;
const DEFAULT_CYCLE_CLOSE_DAY = 20;

export const getAll = async () => {
  return prisma.systemConfig.findMany({ orderBy: { key: "asc" } });
};

export const get = async (key: string): Promise<string | null> => {
  const record = await prisma.systemConfig.findUnique({ where: { key } });
  return record?.value ?? null;
};

export const getCycleOpenDay = async (): Promise<number> => {
  const val = await get("cycleOpenDay");
  if (!val) return DEFAULT_CYCLE_OPEN_DAY;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? DEFAULT_CYCLE_OPEN_DAY : Math.max(1, Math.min(28, parsed));
};

export const getCycleCloseDay = async (): Promise<number> => {
  const val = await get("cycleCloseDay");
  if (!val) return DEFAULT_CYCLE_CLOSE_DAY;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? DEFAULT_CYCLE_CLOSE_DAY : Math.max(1, Math.min(28, parsed));
};

export const getCycleOpenHour = async (): Promise<number> => {
  const val = await get("cycleOpenHour");
  if (!val) return DEFAULT_CYCLE_OPEN_HOUR;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? DEFAULT_CYCLE_OPEN_HOUR : Math.max(0, Math.min(23, parsed));
};

export const set = async (key: string, value: string) => {
  return prisma.systemConfig.upsert({
    where:  { key },
    create: { key, value },
    update: { value },
  });
};

export const setMany = async (entries: Array<{ key: string; value: string }>) => {
  return prisma.$transaction(
    entries.map((e) =>
      prisma.systemConfig.upsert({
        where:  { key: e.key },
        create: { key: e.key, value: e.value },
        update: { value: e.value },
      })
    )
  );
};
