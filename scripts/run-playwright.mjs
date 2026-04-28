import { spawnSync } from 'node:child_process'

const project = process.argv[2]

if (!project) {
  console.error('Usage: node ./scripts/run-playwright.mjs <project>')
  process.exit(1)
}

const playwrightArgs = [
  'playwright',
  'test',
  '--config=playwright.config.ts',
  `--project=${project}`
]
const isLinuxWithoutDisplay =
  process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY

const command = isLinuxWithoutDisplay ? 'xvfb-run' : 'npx'
const args = isLinuxWithoutDisplay ? ['-a', 'npx', ...playwrightArgs] : playwrightArgs

const result = spawnSync(command, args, { stdio: 'inherit', shell: false })
process.exit(result.status ?? 1)
