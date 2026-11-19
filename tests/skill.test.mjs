import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const CLI = fileURLToPath(new URL('../apps/cli/lib/index.js', import.meta.url))
const SCRIPTS = fileURLToPath(new URL('../.agents/skills/locus/scripts', import.meta.url))

test('Skill 脚本按名称选择 Workspace 并读取挂载与 shell 上下文', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'locus-skill-'))
  const data = join(root, 'data')
  const mountPath = join(root, 'work')
  mkdirSync(mountPath)
  const environment = { ...process.env, LOCUS_FOLDER_NAME: undefined, LOCUS_HOME: data, LOCUS_CLI: CLI }
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const run = (args) => {
    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      env: environment,
      timeout: 30000,
      windowsHide: true,
    })
    return {
      code: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }
  }

  const created = run([CLI, '--json', 'post', 'locus://ws', '--data', JSON.stringify({ name: '技能语境' })])
  assert.equal(created.code, 0)
  const workspace = JSON.parse(created.stdout).data
  const mounted = run([
    CLI,
    '--json',
    'post',
    `locus://ws/${workspace.id}/mounts`,
    '--data',
    JSON.stringify({ path: mountPath, name: 'work' }),
  ])
  assert.equal(mounted.code, 0)

  const listed = run([join(SCRIPTS, 'workspace-pick.mjs')])
  assert.equal(listed.code, 0)
  assert.match(listed.stdout, new RegExp(`${workspace.id}\\s+技能语境\\s+1 挂载`))

  const picked = run([join(SCRIPTS, 'workspace-pick.mjs'), '技能语境'])
  assert.equal(picked.code, 0)
  assert.equal(picked.stdout, workspace.id)

  const summary = run([join(SCRIPTS, 'workspace-summary.mjs'), '技能语境'])
  assert.equal(summary.code, 0)
  assert.match(summary.stdout, /work\s+/)
  assert.match(summary.stdout, new RegExp(mountPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  const context = run([join(SCRIPTS, 'shell-context.mjs'), workspace.id, '--json'])
  assert.equal(context.code, 0)
  const parsed = JSON.parse(context.stdout)
  assert.equal(parsed.environment.LOCUS_WORKSPACE_ID, workspace.id)
  assert.equal(parsed.environment.LOCUS_WORKSPACE_NAME, '技能语境')
  assert.equal(parsed.environment.LOCUS_MOUNT_WORK, mountPath)
  assert.equal(parsed.cwd, mountPath)
  assert.deepEqual(parsed.missing, [])
})
