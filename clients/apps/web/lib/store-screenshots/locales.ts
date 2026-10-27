/**
 * Store localizations. Codes follow App Store Connect locale identifiers;
 * `play` is the matching Google Play listing language code.
 */

/** A store language. */
export type StoreLocale = { code: string; name: string; play: string }

/** Languages offered for localized screenshot sets. */
export const STORE_LOCALES: StoreLocale[] = [
  { code: 'en-US', name: 'English (U.S.)', play: 'en-US' },
  { code: 'en-GB', name: 'English (U.K.)', play: 'en-GB' },
  { code: 'en-AU', name: 'English (Australia)', play: 'en-AU' },
  { code: 'en-CA', name: 'English (Canada)', play: 'en-CA' },
  { code: 'de-DE', name: 'German', play: 'de-DE' },
  { code: 'fr-FR', name: 'French', play: 'fr-FR' },
  { code: 'fr-CA', name: 'French (Canada)', play: 'fr-CA' },
  { code: 'es-ES', name: 'Spanish (Spain)', play: 'es-ES' },
  { code: 'es-MX', name: 'Spanish (Mexico)', play: 'es-419' },
  { code: 'it', name: 'Italian', play: 'it-IT' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', play: 'pt-BR' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)', play: 'pt-PT' },
  { code: 'nl-NL', name: 'Dutch', play: 'nl-NL' },
  { code: 'sv', name: 'Swedish', play: 'sv-SE' },
  { code: 'da', name: 'Danish', play: 'da-DK' },
  { code: 'no', name: 'Norwegian', play: 'no-NO' },
  { code: 'fi', name: 'Finnish', play: 'fi-FI' },
  { code: 'pl', name: 'Polish', play: 'pl-PL' },
  { code: 'cs', name: 'Czech', play: 'cs-CZ' },
  { code: 'tr', name: 'Turkish', play: 'tr-TR' },
  { code: 'ru', name: 'Russian', play: 'ru-RU' },
  { code: 'uk', name: 'Ukrainian', play: 'uk' },
  { code: 'ja', name: 'Japanese', play: 'ja-JP' },
  { code: 'ko', name: 'Korean', play: 'ko-KR' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)', play: 'zh-CN' },
  { code: 'zh-Hant', name: 'Chinese (Traditional)', play: 'zh-TW' },
  { code: 'ar-SA', name: 'Arabic', play: 'ar' },
  { code: 'he', name: 'Hebrew', play: 'iw-IL' },
  { code: 'hi', name: 'Hindi', play: 'hi-IN' },
  { code: 'th', name: 'Thai', play: 'th' },
  { code: 'vi', name: 'Vietnamese', play: 'vi' },
  { code: 'id', name: 'Indonesian', play: 'id' },
  { code: 'ms', name: 'Malay', play: 'ms' },
]

const BY_CODE = new Map(STORE_LOCALES.map((locale) => [locale.code, locale]))

/** Name of a locale code, or the code itself. */
export function localeName(code: string): string {
  return BY_CODE.get(code)?.name ?? code
}

/** Google Play language code for a locale. */
export function playLocale(code: string): string {
  return BY_CODE.get(code)?.play ?? code
}

/** Folder-safe locale code for export paths. */
export function localeFolder(code: string): string {
  return code.replace(/[^A-Za-z0-9-]/g, '')
}
