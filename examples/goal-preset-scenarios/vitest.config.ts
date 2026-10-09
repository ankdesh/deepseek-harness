import { resolve } from 'node:path'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from '../../vitest.shared.ts'

export default defineConfig({
  root: resolve(__dirname, '../..'),
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.base.json'] }),
    standardDecoratorPlugin(),
  ],
  test: {
    name: 'goal-preset-scenarios',
    execArgv: vitestExecArgv,
    pool: 'forks',
    include: ['examples/goal-preset-scenarios/tests/**/*.spec.ts'],
    setupFiles: ['./scripts/test-proxy-environment.ts', './scripts/test-invariants.ts'],
  },
})
