import i18n from 'i18next';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

const LANG_KEY = 'forecast_lang';

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    lng: localStorage.getItem(LANG_KEY) || 'pt',
    fallbackLng: 'pt',
    ns: ['common', 'login', 'layout', 'dashboard', 'forecast', 'consolidado', 'tour', 'help'],
    defaultNS: 'common',
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    interpolation: {
      escapeValue: false,
    },
  });

export const setLanguage = (lang: string) => {
  localStorage.setItem(LANG_KEY, lang);
  i18n.changeLanguage(lang);
};

export default i18n;
