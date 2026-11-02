import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execute = promisify(execFile)

// Vite/esbuild needs Node's own typed-array realm. An isolated process also
// proves the real configuration loader without changing the app's jsdom setup.
async function readBuiltProvenance(commit) {
  const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', `
    import { loadConfigFromFile } from 'vite'
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' })
    const info = JSON.parse(loaded.config.define['globalThis.__HMS_STATIC_BUILD_INFO__'])
    const emitted = []
    const plugin = loaded.config.plugins.find((candidate) => candidate.name === 'hms-build-provenance')
    plugin.generateBundle.call({ emitFile: (asset) => emitted.push(asset) })
    process.stdout.write(JSON.stringify({ info, emitted }))
  `], {
    env: { ...process.env, HMS_BUILD_SHA: commit, VERCEL_GIT_COMMIT_SHA: 'f'.repeat(40) },
    timeout: 10000,
  })
  return JSON.parse(stdout)
}

describe('built frontend provenance', () => {
  it('publishes the identical full release commit in application and JSON metadata', async () => {
    const commit = 'ac92aaae6d0c015e20e2b5eafb6fa0c38a2cbd8a'
    const { info, emitted } = await readBuiltProvenance(commit)

    expect(info).toMatchObject({ commit, version: '0.1.0', mode: 'production', branch: null })
    expect(emitted).toEqual([{ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(info) + '\n' }])
  })

  it.each(['abc1234', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), 'a'.repeat(40) + '\n'])(
    'refuses malformed explicit release identity %j', async (commit) => {
      await expect(readBuiltProvenance(commit))
        .rejects.toThrow('HMS_BUILD_SHA must be a full lowercase Git commit SHA')
    },
  )
})
