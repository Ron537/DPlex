import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    {
      name: 'e2e',
      testMatch: '**/*.e2e.spec.ts'
    },
    {
      name: 'monkey',
      testMatch: '**/*.monkey.spec.ts'
    }
  ]
})
