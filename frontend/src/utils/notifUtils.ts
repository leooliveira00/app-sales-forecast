const LOCALE_MAP: Record<string, string> = { pt: 'pt-BR', es: 'es-ES', en: 'en-US' };

export function fmtRefMonth(iso: string | null | undefined, lang: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(LOCALE_MAP[lang] ?? 'pt-BR', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(iso));
}

// Extracts the unit name from a stored notification title ("Forecast aprovado — Unit Name")
function extractUnit(title: string): string {
  return title.includes(' — ') ? title.split(' — ').slice(1).join(' — ') : '';
}

// Extracts the rejection reason embedded in Portuguese body text
// Body format: "...foi reprovado: {reason}." OR "...foi reprovado."
function extractReason(body: string): string {
  const match = body.match(/foi reprovado[:\s]+(.+?)\.?\s*$/i);
  return match?.[1]?.trim() ?? '';
}

type TFunc = (key: string, opts?: Record<string, string>) => string;

export function notifTitle(
  n: { type: string; title: string; refMonth: string | null },
  t: TFunc,
  lang: string
): string {
  const month = fmtRefMonth(n.refMonth, lang);
  const unit  = extractUnit(n.title);
  const key   = `notifTypes.${n.type}.title`;
  const translated = t(key, { month, unit });
  return translated === key ? n.title : translated;
}

export function notifBody(
  n: { type: string; title: string; body: string; refMonth: string | null },
  t: TFunc,
  lang: string
): string {
  const month  = fmtRefMonth(n.refMonth, lang);
  const unit   = extractUnit(n.title);

  if (n.type === 'SUBMISSION_REJECTED') {
    const reason = extractReason(n.body);
    const key = reason ? 'notifTypes.SUBMISSION_REJECTED.bodyReason' : 'notifTypes.SUBMISSION_REJECTED.body';
    const translated = t(key, { month, unit, reason });
    return translated === key ? n.body : translated;
  }

  const key        = `notifTypes.${n.type}.body`;
  const translated = t(key, { month, unit });
  return translated === key ? n.body : translated;
}
