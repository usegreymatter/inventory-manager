// Immutable fixture bytes first; no history or git required for vendored baselines.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const root = new URL('../', import.meta.url)
export function readBaseline(spec) {
  const [revision, ...parts] = spec.split(':')
  const path = parts.join(':')
  if (!/^[a-zA-Z0-9_-]+$/.test(revision) || !path || path.startsWith('/') || path.split('/').includes('..')) throw Error('Invalid baseline spec')
  const fixture = new URL(`fixtures/baselines/${revision}/${path}`, import.meta.url)
  return fs.existsSync(fixture) ? fs.readFileSync(fixture, 'utf8')
    : execFileSync('git', ['show', spec], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
}
export const baselineResult = spec => ({ status: 0, stdout: readBaseline(spec) })
