import { Strings } from 'lit-translate';
import { de as compasDe } from './de.js';
import { en as compasEn } from './en.js';
import { es as compasEs } from './es.js';
import { esOscd } from './es-oscd.js';
import { de as oscdDe } from '@compas-oscd/open-scd/dist/translations/de.js';
import { en as oscdEn } from '@compas-oscd/open-scd/dist/translations/en.js';

export type Language = 'en' | 'de' | 'es';

// DSB: agrega "Español" a la lista de idiomas de Configuración en en/de.
const withEs = <T extends { settings: { languages: object } }>(o: T): T => ({
  ...o,
  settings: {
    ...o.settings,
    languages: { ...o.settings.languages, es: 'Español' },
  },
});

export const languages = {
  en: { ...withEs(oscdEn), ...compasEn },
  de: { ...withEs(oscdDe), ...compasDe },
  es: { ...esOscd, ...compasEs },
};

// DSB: idioma por defecto español (si el usuario no eligió otro).
try {
  if (!localStorage.getItem('language')) localStorage.setItem('language', 'es');
} catch {
  /* localStorage no disponible */
}

export type Translations = typeof compasEn;

export async function loader(lang: string): Promise<Strings> {
  if (Object.keys(languages).includes(lang)) return languages[<Language>lang];
  else return {};
}
