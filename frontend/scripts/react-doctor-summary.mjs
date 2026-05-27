#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_TOP_COUNT = 20

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function parseArgs(argv) {
  const options = {
    input: null,
    json: false,
    top: DEFAULT_TOP_COUNT,
  }

  argv.forEach((arg) => {
    if (arg === '--json') {
      options.json = true
      return
    }
    if (arg.startsWith('--top=')) {
      const parsed = Number.parseInt(arg.slice('--top='.length), 10)
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.top = parsed
      }
      return
    }
    if (!arg.startsWith('-') && !options.input) {
      options.input = arg
    }
  })

  return options
}

function countBy(items, getKey) {
  const counts = new Map()
  items.forEach((item) => {
    const key = getKey(item) || 'unknown'
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function topEntries(counts, limit) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }))
}

export function findLatestDiagnostics(startedAtMs = 0, searchRoot = os.tmpdir()) {
  let entries = []
  try {
    entries = fs.readdirSync(searchRoot, { withFileTypes: true })
  } catch {
    return null
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('react-doctor-'))
    .map((entry) => {
      const diagnosticsPath = path.join(searchRoot, entry.name, 'diagnostics.json')
      if (!isFile(diagnosticsPath)) return null
      const stats = fs.statSync(diagnosticsPath)
      if (stats.mtimeMs < startedAtMs) return null
      return { diagnosticsPath, mtimeMs: stats.mtimeMs }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  return candidates[0]?.diagnosticsPath || null
}

export function resolveDiagnosticsPath(input) {
  if (input) {
    const resolved = path.resolve(input)
    if (isDirectory(resolved)) {
      const diagnosticsPath = path.join(resolved, 'diagnostics.json')
      if (isFile(diagnosticsPath)) return diagnosticsPath
      throw new Error(`No diagnostics.json found in ${resolved}`)
    }
    if (isFile(resolved)) return resolved
    throw new Error(`Diagnostics path does not exist: ${resolved}`)
  }

  const latest = findLatestDiagnostics()
  if (latest) return latest
  throw new Error(`No React Doctor diagnostics found under ${os.tmpdir()}`)
}

function normalizeDiagnosticsPayload(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.diagnostics)) return payload.diagnostics
  if (Array.isArray(payload?.issues)) return payload.issues
  if (Array.isArray(payload?.results)) return payload.results

  if (payload && typeof payload === 'object') {
    const values = Object.values(payload)
    if (values.every((value) => value && typeof value === 'object' && !Array.isArray(value))) {
      return values
    }
    if (values.every(Array.isArray)) {
      return values.flat()
    }
  }

  return []
}

export function loadDiagnostics(diagnosticsPath) {
  const payload = JSON.parse(fs.readFileSync(diagnosticsPath, 'utf8'))
  return normalizeDiagnosticsPayload(payload)
    .filter((diagnostic) => diagnostic && typeof diagnostic === 'object')
    .map((diagnostic) => ({
      filePath: diagnostic.filePath || diagnostic.file || diagnostic.path || 'unknown',
      plugin: diagnostic.plugin || 'react-doctor',
      rule: diagnostic.rule || diagnostic.ruleId || diagnostic.name || 'unknown',
      severity: String(diagnostic.severity || diagnostic.level || 'unknown').toLowerCase(),
      category: diagnostic.category || diagnostic.type || 'Uncategorized',
      message: diagnostic.message || '',
      help: diagnostic.help || '',
      line: diagnostic.line ?? null,
      column: diagnostic.column ?? null,
    }))
}

export function summarizeDiagnostics(diagnostics, { top = DEFAULT_TOP_COUNT } = {}) {
  const bySeverity = countBy(diagnostics, (diagnostic) => diagnostic.severity)
  const byCategory = countBy(diagnostics, (diagnostic) => diagnostic.category)
  const byRule = countBy(diagnostics, (diagnostic) => diagnostic.rule)
  const byFile = countBy(diagnostics, (diagnostic) => diagnostic.filePath)

  return {
    total: diagnostics.length,
    bySeverity,
    byCategory,
    byRule,
    byFile,
    topRules: topEntries(byRule, top),
    topFiles: topEntries(byFile, top),
  }
}

function formatCounts(counts) {
  const entries = Object.entries(counts)
  if (entries.length === 0) return 'none'
  return entries.map(([name, count]) => `${name}: ${count}`).join(', ')
}

function printTable(title, rows) {
  console.log(`\n${title}`)
  if (rows.length === 0) {
    console.log('  none')
    return
  }
  rows.forEach((row) => {
    console.log(`  ${String(row.count).padStart(5)}  ${row.name}`)
  })
}

function printSummary(diagnosticsPath, summary) {
  console.log(`React Doctor diagnostics: ${diagnosticsPath}`)
  console.log(`Total issues: ${summary.total}`)
  console.log(`By severity: ${formatCounts(summary.bySeverity)}`)
  console.log(`By category: ${formatCounts(summary.byCategory)}`)
  printTable('Top rules', summary.topRules)
  printTable('Top files', summary.topFiles)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const diagnosticsPath = resolveDiagnosticsPath(options.input)
  const diagnostics = loadDiagnostics(diagnosticsPath)
  const summary = summarizeDiagnostics(diagnostics, { top: options.top })

  if (options.json) {
    console.log(JSON.stringify({ diagnosticsPath, ...summary }, null, 2))
    return
  }

  printSummary(diagnosticsPath, summary)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
