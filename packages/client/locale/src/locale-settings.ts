/** Locale preference stored in the Host user-settings document. */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the locale plugin. */
export const LOCALE_SETTINGS_NAMESPACE = 'locale'

/** Field carrying an explicit locale selection; absence delegates to the browser. */
export const LOCALE_PREFERENCE_FIELD = 'preference'

/** Accepted BCP 47-style language ids. */
export const LOCALE_ID_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u

/** Baseline locales required by typed namespace dictionary registration. */
export const LOCALE_IDS = ['zh', 'en'] as const

/** Baseline locale required by typed namespace dictionary registration. */
export type BuiltInLocaleId = typeof LOCALE_IDS[number]

/** Open locale identifier accepted from language-pack plugins. */
export type LocaleId = string

/** Durable locale section shared by the Host schema and the browser scope. */
export interface LocaleSettings {
  /** Explicit locale selection; absence delegates to the browser. */
  preference?: LocaleId
}

/** Durable locale schema; also the wire envelope the browser scope validates against. */
export const LocaleSettingsFields = {
  [LOCALE_PREFERENCE_FIELD]: z.string().pattern(LOCALE_ID_PATTERN).required(false),
}

/** Schema for the shared locale preference. */
export const LocaleSettingsSchema = z.object(LocaleSettingsFields)


/** Host preferences and deployment policy projected to the browser. */
export interface LocaleConfig {
  /** Explicit locale; omission follows the browser. */
  preference: Volatile<string | undefined>
  /** Locale ids allowed by the deployment. */
  allowedLocales: Volatile<string[] | undefined>
  /** Initial locale when the deployment sets one. */
  defaultLocale: Volatile<string | undefined>
  /** Whether the browser presents the Language setting. */
  showLanguageSetting: Volatile<boolean>
}
