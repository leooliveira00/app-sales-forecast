/**
 * Dia civil no fuso de negócio dos ciclos (ver `backend/src/utils/business-time.ts`).
 *
 * O fechamento do ciclo é gravado pelo backend como o último segundo do dia de
 * fechamento **no horário de Brasília** — ou seja, um instante que em UTC cai no
 * dia seguinte (28/07 23:59:59 BRT = 29/07 02:59:59 UTC). Formatar ou contar dias
 * a partir dos componentes UTC desse instante devolveria o dia errado (29/07).
 *
 * Use estes helpers para `availableUntil` / `closeDate`. Para datas puras que já
 * são meia-noite UTC (`refMonth`, `scheduledDagDate`) continue lendo os
 * componentes UTC diretamente — converter fuso ali retrocederia um dia.
 */

export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year:     'numeric',
  month:    '2-digit',
  day:      '2-digit',
});

interface DayParts { year: number; month: number; day: number }

/** Componentes do dia civil (fuso de negócio) do instante informado. */
function dayParts(value: string | Date): DayParts {
  const date = typeof value === 'string' ? new Date(value) : value;
  const [year, month, day] = dayFmt.format(date).split('-').map(Number);
  return { year, month, day };
}

/**
 * `Date` local cujos componentes de dia/mês/ano são os do dia civil no fuso de
 * negócio — pronto para formatação (date-fns) sem novo deslocamento de fuso.
 */
export function businessDay(value: string | Date): Date {
  const { year, month, day } = dayParts(value);
  return new Date(year, month - 1, day);
}

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  hour12:   false,
  year:     'numeric',
  month:    '2-digit',
  day:      '2-digit',
  hour:     '2-digit',
  minute:   '2-digit',
  second:   '2-digit',
});

/** Offset do fuso de negócio em relação ao UTC (ms) no instante informado. */
function offsetMs(date: Date): number {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(date)) p[type] = value;
  const asIfUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asIfUTC - date.getTime();
}

/**
 * Instante UTC de um horário de parede **no fuso de negócio** — espelho de
 * `businessDayAt` em `backend/src/utils/business-time.ts`.
 *
 * Ex.: `businessDayAt(2026, 7, 10, 8)` → instante de 10/08/2026 08:00 em
 * Brasília (11:00 UTC). Usado para prever a abertura do ciclo na tela de
 * configuração com o mesmo resultado que o backend vai gravar.
 *
 * @param monthIndex mês 0-based, como em `Date.UTC`.
 */
export function businessDayAt(
  year:       number,
  monthIndex: number,
  day:        number,
  hour        = 0,
): Date {
  const wallClock = Date.UTC(year, monthIndex, day, hour);
  const first     = wallClock - offsetMs(new Date(wallClock));
  return new Date(wallClock - offsetMs(new Date(first)));
}

/**
 * Data e hora de um instante, já no fuso de negócio, prontas para exibição.
 *
 * A abertura do ciclo é gravada como 08:00 em Brasília — que em UTC é 11:00.
 * Formatar pelos componentes UTC mostraria "11:00h (UTC)" ao gestor, e formatar
 * pelo fuso do navegador daria resultados diferentes para quem estiver fora do
 * país. Ambos os campos saem daqui no fuso de negócio, no locale da interface.
 */
export function businessDateTimeParts(
  value:  string | Date,
  locale: string = 'pt-BR'
): { date: string; time: string } {
  const date = typeof value === 'string' ? new Date(value) : value;
  return {
    date: new Intl.DateTimeFormat(locale, {
      timeZone: BUSINESS_TIME_ZONE,
      day:      '2-digit',
      month:    '2-digit',
      year:     'numeric',
    }).format(date),
    time: new Intl.DateTimeFormat(locale, {
      timeZone: BUSINESS_TIME_ZONE,
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   false,
    }).format(date),
  };
}

/**
 * Dias de calendário (no fuso de negócio) entre `from` e `target`.
 * Hoje → 0, amanhã → 1, ontem → -1. Ignora a hora: o que importa é o dia.
 */
export function daysUntilBusinessDay(value: string | Date, from: string | Date = new Date()): number {
  const a = dayParts(value);
  const b = dayParts(from);
  const diff = Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
  return Math.round(diff / 86_400_000);
}
