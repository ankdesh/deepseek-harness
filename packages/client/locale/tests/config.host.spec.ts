import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import {
  Config, apply,
} from '@deepseek-ai/dsh-client-locale'


describe('locale host', () => {
  it('retains product locale policy in the Host fields sent to the browser', () => {
    const policy = new Config({ allowedLocales: ['en'], defaultLocale: 'en', showLanguageSetting: false })
    expect(policy.allowedLocales.get()).toEqual(['en'])
    expect(policy.defaultLocale.get()).toBe('en')
    expect(policy.showLanguageSetting.get()).toBe(false)
  })

  it('registers an open locale preference with the Host settings lifecycle', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    expect(plainConfig(configuration.fiber.effectiveConfig)).toMatchObject({ preference: undefined, showLanguageSetting: true })
    await configuration.update({ preference: 'en' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toMatchObject({ preference: 'en', showLanguageSetting: true })
    await configuration.update({ preference: 'pt-BR' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toMatchObject({ preference: 'pt-BR', showLanguageSetting: true })
    await expect(configuration.update({ preference: 'bad locale' })).rejects.toThrow()
    await expect(configuration.update({ preference: '123' })).rejects.toThrow()
    await fiber.dispose()
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
