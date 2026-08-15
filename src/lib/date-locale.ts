import { enUS, ko, ptBR } from "date-fns/locale";
import type { Locale } from "date-fns";

/**
 * Maps NEXT_PUBLIC_APP_LOCALE (next-intl's app locale, see src/i18n/request.ts)
 * to the matching date-fns Locale, so month names / relative-time words
 * ("2 hours ago" vs "há 2 horas") follow the deployment's language instead
 * of always defaulting to date-fns' built-in en-US.
 */
const DATE_FNS_LOCALES: Record<string, Locale> = {
  en: enUS,
  ko,
  "pt-BR": ptBR,
};

export function getDateFnsLocale(appLocale: string): Locale {
  return DATE_FNS_LOCALES[appLocale] ?? enUS;
}
