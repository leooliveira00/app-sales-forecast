import { useTranslation } from 'react-i18next';

const LOCALE_MAP: Record<string, string> = {
  pt: 'pt-BR',
  es: 'es-ES',
  en: 'en-US',
};

export function useFormatter() {
  const { i18n } = useTranslation();
  const locale = LOCALE_MAP[i18n.language] ?? 'pt-BR';

  const fmt = (v: number | null | undefined): string =>
    v != null ? new Intl.NumberFormat(locale).format(v) : '—';

  const fmtDate = (date: Date | string, opts?: Intl.DateTimeFormatOptions): string =>
    new Date(date).toLocaleDateString(locale, opts);

  return { fmt, fmtDate, locale };
}
