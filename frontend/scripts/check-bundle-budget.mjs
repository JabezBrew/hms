import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const DIST_DIR = path.resolve(process.cwd(), 'dist')
const INDEX_HTML = path.join(DIST_DIR, 'index.html')
const ASSETS_DIR = path.join(DIST_DIR, 'assets')

const KB = 1024

const BUDGETS = {
  startupGzipKb: Number(process.env.BUDGET_STARTUP_GZIP_KB || 90),
  startupRawKb: Number(process.env.BUDGET_STARTUP_RAW_KB || 350),
  entryJsGzipKb: Number(process.env.BUDGET_ENTRY_JS_GZIP_KB || 40),
  entryCssGzipKb: Number(process.env.BUDGET_ENTRY_CSS_GZIP_KB || 45),
  largestChunkGzipKb: Number(process.env.BUDGET_LARGEST_CHUNK_GZIP_KB || 120),
}

function toKb(bytes) {
  return Number((bytes / KB).toFixed(2))
}

function getFileStats(filePath) {
  const raw = fs.readFileSync(filePath)
  return {
    rawBytes: raw.length,
    gzipBytes: zlib.gzipSync(raw, { level: 9 }).length,
  }
}

function parseEntryAssets(indexHtml) {
  const scriptRegex = /<script[^>]+type="module"[^>]+src="([^"]+)"/g
  const modulePreloadRegex = /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g
  const cssRegex = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g

  const scripts = []
  const modulePreloads = []
  const styles = []

  let match = null
  while ((match = scriptRegex.exec(indexHtml)) !== null) {
    scripts.push(match[1])
  }

  while ((match = modulePreloadRegex.exec(indexHtml)) !== null) {
    modulePreloads.push(match[1])
  }

  while ((match = cssRegex.exec(indexHtml)) !== null) {
    styles.push(match[1])
  }

  return { scripts, modulePreloads, styles }
}

function resolveDistAsset(assetPath) {
  const sanitized = assetPath.replace(/^\//, '')
  return path.join(DIST_DIR, sanitized)
}

function fail(message, errors) {
  console.error(`\n[perf-budget] ${message}`)
  errors.forEach((line) => console.error(`  - ${line}`))
  process.exit(1)
}

if (!fs.existsSync(INDEX_HTML)) {
  fail('dist/index.html not found. Run "npm run build" first.', [])
}

const indexHtml = fs.readFileSync(INDEX_HTML, 'utf8')
const { scripts, modulePreloads, styles } = parseEntryAssets(indexHtml)

const entryScriptStats = scripts
  .map((asset) => ({ asset, ...getFileStats(resolveDistAsset(asset)) }))
const entryStyleStats = styles
  .map((asset) => ({ asset, ...getFileStats(resolveDistAsset(asset)) }))

const totalEntryRaw = [...entryScriptStats, ...entryStyleStats].reduce((sum, item) => sum + item.rawBytes, 0)
const totalEntryGzip = [...entryScriptStats, ...entryStyleStats].reduce((sum, item) => sum + item.gzipBytes, 0)

const entryJsGzip = entryScriptStats.reduce((sum, item) => sum + item.gzipBytes, 0)
const entryCssGzip = entryStyleStats.reduce((sum, item) => sum + item.gzipBytes, 0)

const jsChunks = fs.existsSync(ASSETS_DIR)
  ? fs.readdirSync(ASSETS_DIR).filter((name) => name.endsWith('.js'))
  : []

let largestJsChunk = { name: null, gzipBytes: 0 }
for (const chunk of jsChunks) {
  const stats = getFileStats(path.join(ASSETS_DIR, chunk))
  if (stats.gzipBytes > largestJsChunk.gzipBytes) {
    largestJsChunk = { name: chunk, gzipBytes: stats.gzipBytes }
  }
}

const checks = [
  {
    label: 'Startup transfer (gzip)',
    actual: toKb(totalEntryGzip),
    max: BUDGETS.startupGzipKb,
  },
  {
    label: 'Startup transfer (raw)',
    actual: toKb(totalEntryRaw),
    max: BUDGETS.startupRawKb,
  },
  {
    label: 'Entry JS (gzip)',
    actual: toKb(entryJsGzip),
    max: BUDGETS.entryJsGzipKb,
  },
  {
    label: 'Entry CSS (gzip)',
    actual: toKb(entryCssGzip),
    max: BUDGETS.entryCssGzipKb,
  },
  {
    label: 'Largest JS chunk (gzip)',
    actual: toKb(largestJsChunk.gzipBytes),
    max: BUDGETS.largestChunkGzipKb,
  },
]

console.log('\n[perf-budget] Frontend bundle budget report')
checks.forEach((check) => {
  console.log(
    `  - ${check.label}: ${check.actual} KB (budget ${check.max} KB)`
  )
})

if (largestJsChunk.name) {
  console.log(`  - Largest JS chunk: ${largestJsChunk.name}`)
}

const initialJsAssets = [...scripts, ...modulePreloads]
const forbiddenInitialChunks = [/\/vendor-recharts-[^/]+\.js$/]
const forbiddenInitialAssets = initialJsAssets.filter((asset) =>
  forbiddenInitialChunks.some((pattern) => pattern.test(asset))
)

console.log(`  - Initial modulepreloads: ${modulePreloads.length}`)
console.log(
  `  - Initial chart chunks: ${forbiddenInitialAssets.length === 0 ? 'none' : forbiddenInitialAssets.join(', ')}`
)

const failures = checks
  .filter((check) => check.actual > check.max)
  .map((check) => `${check.label} exceeded: ${check.actual} KB > ${check.max} KB`)

forbiddenInitialAssets.forEach((asset) => {
  failures.push(`Charting chunk must stay lazy, but ${asset} is in the initial script/preload set`)
})

if (failures.length > 0) {
  fail('Bundle budget check failed.', failures)
}

console.log('[perf-budget] All budgets passed.\n')
