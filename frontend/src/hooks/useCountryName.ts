import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import countries from 'i18n-iso-countries';
import ptLocale from 'i18n-iso-countries/langs/pt.json';
import enLocale from 'i18n-iso-countries/langs/en.json';
import esLocale from 'i18n-iso-countries/langs/es.json';

// Registra os locales uma única vez (idempotente).
// Os nomes de país são derivados do código ISO 3166-1 alpha-3 (Pais.iso3),
// que é padronizado — dispensa tradução manual. O nome do banco (Pais.nome)
// fica como fallback para qualquer código não reconhecido pela biblioteca.
countries.registerLocale(ptLocale as Parameters<typeof countries.registerLocale>[0]);
countries.registerLocale(enLocale as Parameters<typeof countries.registerLocale>[0]);
countries.registerLocale(esLocale as Parameters<typeof countries.registerLocale>[0]);

/**
 * Retorna uma função que resolve o nome localizado de um país a partir do iso3,
 * no idioma ativo. Cai para `fallback` (tipicamente Pais.nome) e, por fim, o iso3.
 * Reativo à troca de idioma (useTranslation dispara re-render).
 */
export function useCountryName() {
  const { i18n } = useTranslation();
  const lang = (i18n.language || 'pt').split('-')[0];
  return useCallback(
    (iso3: string | null | undefined, fallback?: string | null): string =>
      (iso3 ? countries.getName(iso3, lang) : null) || fallback || iso3 || '',
    [lang],
  );
}
