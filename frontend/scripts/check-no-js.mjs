import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const TARGETS = ['src', 'tests']
const DISALLOWED = new Set(['.js', '.jsx'])
const offenders = []

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
      continue
    }

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath)
      continue
    }

    const ext = path.extname(entry.name)
    if (DISALLOWED.has(ext)) {
      offenders.push(path.relative(ROOT, fullPath))
    }
  }
}

for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel)
  if (fs.existsSync(abs)) {
    walk(abs)
  }
}

if (offenders.length > 0) {
  console.error('[check:no-js] Found JavaScript files in src/tests:')
  offenders.sort().forEach((file) => console.error(`  - ${file}`))
  process.exit(1)
}

console.log('[check:no-js] OK: no .js/.jsx files under src/ and tests/.')
