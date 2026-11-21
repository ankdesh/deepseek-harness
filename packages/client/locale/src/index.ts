/** Host registration for the browser locale preference. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Context } from '@deepseek-ai/cordis'

import z from '@deepseek-ai/schemastery'
import { LOCALE_ID_PATTERN, LOCALE_PREFERENCE_FIELD } from './locale-settings.ts'

import { LocaleSettingsFields, type LocaleConfig } from './locale-settings.ts'

export {
  LOCALE_IDS, LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE,
  type BuiltInLocaleId, type LocaleId, type LocaleSettings,
} from './locale-settings.ts'

/** Settings that the Host projects to the browser. */
export type Config = LocaleConfig

/** Live preferences projected to the browser. */
export const Config = z.object({
  [LOCALE_PREFERENCE_FIELD]: LocaleSettingsFields[LOCALE_PREFERENCE_FIELD].volatile(),
  allowedLocales: z.array(z.string().pattern(LOCALE_ID_PATTERN)).required(false).volatile(),
  defaultLocale: z.string().pattern(LOCALE_ID_PATTERN).required(false).volatile(),
  showLanguageSetting: z.boolean().default(true).volatile(),
})

/** Host preferences are consumed through the configuration form projection.
 * @param ctx Plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
