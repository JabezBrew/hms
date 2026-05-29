#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import {
  findLatestDiagnostics,
  loadDiagnostics,
  resolveDiagnosticsPath,
  summarizeDiagnostics,
} from './react-doctor-summary.mjs'

const REACT_DOCTOR_CACHE = '/private/tmp/react-doctor-npm-cache'

function parseArgs(argv) {
  const options = {
    diff: false,
    skipLint: false,
    skipBuild: false,
    skipDoctor: false,
    json: false,
    maxErrors: 0,
    maxWarnings: Number.POSITIVE_INFINITY,
    diagnosticsPath: null,
  }

  argv.forEach((arg) => {
    if (arg === '--diff') options.diff = true
    else if (arg === '--full') options.diff = false
    else if (arg === '--skip-lint' || arg === '--no-lint') options.skipLint = true
    else if (arg === '--skip-build' || arg === '--no-build') options.skipBuild = true
    else if (arg === '--skip-doctor' || arg === '--no-doctor') options.skipDoctor = true
    else if (arg === '--json') options.json = true
    else if (arg === '--strict-warnings') options.maxWarnings = 0
    else if (arg.startsWith('--max-errors=')) options.maxErrors = Number.parseInt(arg.slice('--max-errors='.length), 10)
    else if (arg.startsWith('--max-warnings=')) options.maxWarnings = Number.parseInt(arg.slice('--max-warnings='.length), 10)
    else if (arg.startsWith('--diagnostics=')) options.diagnosticsPath = arg.slice('--diagnostics='.length)
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  })

  if (!Number.isFinite(options.maxErrors) || options.maxErrors < 0) options.maxErrors = 0
  if (!Number.isFinite(options.maxWarnings) || options.maxWarnings < 0) options.maxWarnings = Number.POSITIVE_INFINITY

  return options
}

function printHelp() {
  console.log(`Usage: node scripts/react-quality-gate.mjs [options]

Options:
  --diff                 Run React Doctor on changed files only.
  --full                 Run a full React Doctor scan. This is the default.
  --skip-lint            Do not run npm run lint.
  --skip-build           Do not run npm run build.
  --skip-doctor          Do not run React Doctor.
  --diagnostics=<path>   Summarize an existing diagnostics.json or diagnostics directory.
  --max-errors=<n>       Fail when React Doctor errors exceed n. Default: 0.
  --max-warnings=<n>     Fail when React Doctor warnings exceed n. Default: no limit.
  --strict-warnings      Equivalent to --max-warnings=0.
  --json                 Emit a JSON result summary.
`)
}

function runCommand(label, command, args, { env = {} } = {}) {
  console.log(`\n==> ${label}`)
  console.log(`$ ${[command, ...args].join(' ')}`)

  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  })

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)

  return {
    status: result.status ?? 1,
    signal: result.signal,
    output: `${result.stdout || ''}${result.stderr || ''}`,
    error: result.error,
  }
}

function extractDiagnosticsPath(output) {
  const match = output.match(/Full diagnostics written to\s+(.+)\s*$/m)
  if (!match) return null
  return match[1].trim()
}

function severityCount(summary, severity) {
  return summary.bySeverity[severity] || 0
}

function printDoctorSummary(diagnosticsPath, summary) {
  console.log('\n==> React Doctor Summary')
  console.log(`Diagnostics: ${diagnosticsPath}`)
  console.log(`Total: ${summary.total}`)
  console.log(`Errors: ${severityCount(summary, 'error')}`)
  console.log(`Warnings: ${severityCount(summary, 'warning')}`)
  console.log('Top rules:')
  summary.topRules.slice(0, 10).forEach((row) => {
    console.log(`  ${String(row.count).padStart(5)}  ${row.name}`)
  })
}

function exitWithResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
  }
  process.exit(result.ok ? 0 : 1)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const result = {
    ok: true,
    lint: null,
    build: null,
    reactDoctor: null,
  }

  if (!options.skipLint) {
    const lint = runCommand('Lint', 'npm', ['run', 'lint'])
    result.lint = { status: lint.status }
    if (lint.status !== 0) {
      result.ok = false
      return exitWithResult(result, options.json)
    }
  }

  if (!options.skipBuild) {
    const build = runCommand('Build', 'npm', ['run', 'build'])
    result.build = { status: build.status }
    if (build.status !== 0) {
      result.ok = false
      return exitWithResult(result, options.json)
    }
  }

  if (options.skipDoctor) {
    return exitWithResult(result, options.json)
  }

  const startedAtMs = Date.now() - 1000
  let diagnosticsPath = options.diagnosticsPath ? resolveDiagnosticsPath(options.diagnosticsPath) : null
  let doctorStatus = 0
  let doctorOutput = ''

  if (!diagnosticsPath) {
    const doctorArgs = ['--yes', 'react-doctor@latest', '--verbose']
    if (options.diff) doctorArgs.push('--diff')
    const doctor = runCommand(
      `React Doctor${options.diff ? ' diff' : ' full scan'}`,
      'npx',
      doctorArgs,
      { env: { npm_config_cache: REACT_DOCTOR_CACHE } },
    )
    doctorStatus = doctor.status
    doctorOutput = doctor.output
    diagnosticsPath = extractDiagnosticsPath(doctor.output) || findLatestDiagnostics(startedAtMs)
    result.reactDoctor = { status: doctorStatus, diagnosticsPath }
  } else {
    result.reactDoctor = { status: doctorStatus, diagnosticsPath }
  }

  if (!diagnosticsPath) {
    const emptyDoctorScan = /No changed source files/i.test(doctorOutput)
      || /No issues found/i.test(doctorOutput)
    if (emptyDoctorScan) {
      result.reactDoctor = {
        ...result.reactDoctor,
        diagnosticsPath: null,
        total: 0,
        bySeverity: {},
        byCategory: {},
        topRules: [],
        skipped: 'no findings',
      }
      return exitWithResult(result, options.json)
    }
    result.ok = false
    result.reactDoctor = {
      ...result.reactDoctor,
      error: 'React Doctor did not produce diagnostics.json',
    }
    return exitWithResult(result, options.json)
  }

  const diagnostics = loadDiagnostics(diagnosticsPath)
  const summary = summarizeDiagnostics(diagnostics)
  const errors = severityCount(summary, 'error')
  const warnings = severityCount(summary, 'warning')
  result.reactDoctor = {
    ...result.reactDoctor,
    diagnosticsPath: path.resolve(diagnosticsPath),
    total: summary.total,
    bySeverity: summary.bySeverity,
    byCategory: summary.byCategory,
    topRules: summary.topRules.slice(0, 10),
  }

  if (!options.json) {
    printDoctorSummary(diagnosticsPath, summary)
  }

  if (errors > options.maxErrors) {
    result.ok = false
    result.reactDoctor.error = `React Doctor errors ${errors} exceed limit ${options.maxErrors}`
  }

  if (warnings > options.maxWarnings) {
    result.ok = false
    result.reactDoctor.warning = `React Doctor warnings ${warnings} exceed limit ${options.maxWarnings}`
  }

  if (doctorStatus !== 0 && summary.total === 0) {
    result.ok = false
    result.reactDoctor.error = result.reactDoctor.error || `React Doctor exited with status ${doctorStatus}`
  }

  exitWithResult(result, options.json)
}

main()
