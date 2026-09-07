/**
 * Fuso de negócio dos ciclos de forecast.
 *
 * Contexto: todo o modelo de datas do app é UTC (refMonth, janelas, snapshots).
 * Isso está correto para datas puras (mês de referência), mas o **fechamento do
 * ciclo** é um limite percebido pelo usuário: "o ciclo fecha dia 28". Gravar
 * `Date.UTC(..., 28, 23, 59, 59)` fazia a janela expirar às 20:59:59 de Brasília —
 * o gestor perdia as últimas 3 horas do dia 28 e as telas que contavam dias
 * exibiam o fechamento como se fosse dia 29.
 *
 * Aqui o dia de fechamento é resolvido no fuso de negócio e convertido para o
 * instante UTC equivalente, que é o que vai ao banco.
 */

export const BUSINESS_TIME_ZONE = "America/Sao_Paulo";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hour12:   false,
  year:     "numeric",
  month:    "2-digit",
  day:      "2-digit",
  hour:     "2-digit",
  minute:   "2-digit",
  second:   "2-digit",
});

/** Offset do fuso de negócio em relação ao UTC (ms) no instante informado. */
function offsetMs(date: Date): number {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(date)) p[type] = value;

  const asIfUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24, // "24" aparece em algumas ICUs para meia-noite
    Number(p.minute),
    Number(p.second),
  );
  return asIfUTC - date.getTime();
}

/**
 * Instante UTC correspondente a um horário de parede **no fuso de negócio**.
 *
 * Ex.: `businessDayAt(2026, 7, 10, 8)` → `2026-08-10T11:00:00Z`
 *      (= 10/08/2026 08:00 em Brasília).
 *
 * @param monthIndex mês 0-based, como em `Date.UTC`.
 */
export function businessDayAt(
  year:       number,
  monthIndex: number,
  day:        number,
  hour       = 0,
  minute     = 0,
  second     = 0,
): Date {
  const wallClock = Date.UTC(year, monthIndex, day, hour, minute, second);
  // Duas passadas: a primeira estima o offset a partir do horário de parede,
  // a segunda corrige o caso de o offset ser diferente no instante resultante
  // (relevante se o Brasil voltar a adotar horário de verão).
  const first = wallClock - offsetMs(new Date(wallClock));
  return new Date(wallClock - offsetMs(new Date(first)));
}

/**
 * Instante UTC correspondente ao último segundo (23:59:59) do dia informado
 * **no fuso de negócio**.
 *
 * Ex.: `endOfBusinessDay(2026, 6, 28)` → `2026-07-29T02:59:59Z`
 *      (= 28/07/2026 23:59:59 em Brasília).
 *
 * @param monthIndex mês 0-based, como em `Date.UTC`.
 */
export function endOfBusinessDay(year: number, monthIndex: number, day: number): Date {
  return businessDayAt(year, monthIndex, day, 23, 59, 59);
}

/** Componentes do dia civil (fuso de negócio) do instante informado. */
function businessDayParts(date: Date): { year: number; month: number; day: number } {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(date)) p[type] = value;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
}

/**
 * Próxima ocorrência de `hour:00:00` no fuso de negócio, em `from` ou depois.
 *
 * Usado na abertura de ciclo: quando a prontidão chega fora do horário de
 * liberação, o ciclo espera o próximo horário cheio em vez de abrir na hora.
 * Ex.: prontidão às 13h32 de 11/08 com `hour = 8` → 12/08 08:00 BRT.
 */
export function nextBusinessTimeAt(from: Date, hour: number): Date {
  const { year, month, day } = businessDayParts(from);
  const hoje = businessDayAt(year, month - 1, day, hour);
  if (hoje >= from) return hoje;
  return businessDayAt(year, month - 1, day + 1, hour);   // Date.UTC normaliza a virada de mês
}
