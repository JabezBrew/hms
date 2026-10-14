import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const scriptPath = path.resolve(process.cwd(), 'scripts/measure-runtime-perf.mjs')

function runProbe(overrides = {}) {
  const environment = { ...process.env }
  delete environment.HMS_FRONTEND_PERF_PASSWORD
  delete environment.HMS_FRONTEND_PERF_BROWSER_EXECUTABLE
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: { ...environment, ...overrides },
    timeout: 15000,
  }, 20000)
  return { status: result.status, output: result.stdout + result.stderr }
}

describe('runtime performance probe setup', () => {
  it('requires an explicit password before launching or contacting the API', () => {
    const result = runProbe()

    expect(result.status).toBe(1)
    expect(result.output).toContain('HMS_FRONTEND_PERF_PASSWORD is required')
    expect(result.output).not.toContain('Executable doesn')
  }, 20000)

  it('keeps credentials and private executable paths out of setup-error output', () => {
    const password = 'synthetic-private-test-value'
    const executablePath = '/tmp/hms-synthetic-private-path/no-browser'
    const result = runProbe({
      HMS_FRONTEND_PERF_PASSWORD: password,
      HMS_FRONTEND_PERF_BROWSER_EXECUTABLE: executablePath,
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('Browser/API measurement failed')
    expect(result.output).not.toContain(password)
    expect(result.output).not.toContain(executablePath)
  })
})
