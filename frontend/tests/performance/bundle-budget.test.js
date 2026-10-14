import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = path.resolve(process.cwd(), 'scripts/check-bundle-budget.mjs')
const temporaryDirectories = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }))
})

function runBudget({ preloads = [], files = {}, budgets = {} } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-bundle-budget-'))
  temporaryDirectories.push(directory)
  const assets = path.join(directory, 'dist/assets')
  fs.mkdirSync(assets, { recursive: true })
  const entryTags = [
    '<script type="module" src="/assets/entry.js"></script>',
    '<link rel="stylesheet" href="/assets/entry.css">',
  ]
  fs.writeFileSync(path.join(directory, 'dist/index.html'), [
    ...entryTags,
    ...preloads.map((asset) => `<link rel="modulepreload" href="/assets/${asset}">`),
  ].join('\n'))
  Object.entries({ 'entry.js': 'export const entry = true;', 'entry.css': 'body { color: black; }', ...files })
    .forEach(([name, contents]) => fs.writeFileSync(path.join(assets, name), contents))

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      BUDGET_STARTUP_GZIP_KB: '90',
      BUDGET_STARTUP_RAW_KB: '350',
      BUDGET_TOTAL_STARTUP_GZIP_KB: '225',
      BUDGET_TOTAL_STARTUP_RAW_KB: '850',
      BUDGET_ENTRY_JS_GZIP_KB: '40',
      BUDGET_ENTRY_CSS_GZIP_KB: '45',
      BUDGET_LARGEST_CHUNK_GZIP_KB: '120',
      ...budgets,
    },
  })
  return { status: result.status, output: result.stdout + result.stderr }
}

describe('production bundle budgets', () => {
  it('includes modulepreloads in the initial script/style ceiling', () => {
    const result = runBudget({
      preloads: ['large.js'],
      files: { 'large.js': 'x'.repeat(900 * 1024) },
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('Initial scripts/styles (raw; includes modulepreloads) exceeded')
    expect(result.output).not.toContain('Entry scripts/styles (raw; excludes modulepreloads) exceeded')
  })

  it('deduplicates preload assets, including a preload of the entry script', () => {
    const result = runBudget({
      preloads: ['entry.js', 'shared.js', 'shared.js'],
      files: { 'shared.js': 'x'.repeat(1024) },
      budgets: { BUDGET_TOTAL_STARTUP_RAW_KB: '1.1' },
    })

    expect(result.status).toBe(0)
    expect(result.output).toContain('Initial modulepreloads: 2')
  })

  it.each(['vendor-echarts-synthetic.js', 'vendor-zrender-synthetic.js'])(
    'rejects initial chart dependency %s',
    (chunk) => {
      const result = runBudget({ preloads: [chunk], files: { [chunk]: 'export const chart = true;' } })

      expect(result.status).toBe(1)
      expect(result.output).toContain('Charting chunk must stay lazy')
    },
  )

  it('retains the existing entry-file budget independently', () => {
    const result = runBudget({ files: { 'entry.js': 'x'.repeat(360 * 1024) } })

    expect(result.status).toBe(1)
    expect(result.output).toContain('Entry scripts/styles (raw; excludes modulepreloads) exceeded')
  })
})
