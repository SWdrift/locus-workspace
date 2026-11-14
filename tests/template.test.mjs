import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const CLI = fileURLToPath(new URL('../apps/cli/lib/index.js', import.meta.url))

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-template-cli-'))
  const data = join(root, 'data')
  const run = (args, options = {}) => {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      cwd: options.cwd ?? root,
      env: { ...process.env, LOCUS_HOME: data },
      timeout: 30000,
      windowsHide: true,
    })
    return {
      code: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }
  }
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, data, run }
}

test('template list/create 复制内置与本地模板，不触碰 Workspace 数据库', async (t) => {
  const f = fixture(t)
  const listed = f.run(['--json', 'template', 'list'])
  assert.equal(listed.code, 0)
  const templates = JSON.parse(listed.stdout)
  assert.ok(templates.some((template) => template.id === 'minimal'))
  assert.equal(existsSync(f.data), false)

  const builtinDestination = join(f.root, 'builtin-project')
  const builtin = f.run(['--json', 'template', 'create', 'minimal', builtinDestination])
  assert.equal(builtin.code, 0)
  const builtinResult = JSON.parse(builtin.stdout)
  assert.equal(builtinResult.template.sourceKind, 'builtin')
  assert.equal(existsSync(join(builtinDestination, '.template.json')), true)
  assert.equal(existsSync(join(builtinDestination, 'template.json')), false)
  assert.equal(existsSync(f.data), false)

  const source = join(f.root, 'local-template')
  mkdirSync(join(source, 'src'), { recursive: true })
  writeFileSync(
    join(source, 'template.json'),
    JSON.stringify({ id: 'local-cli', name: 'Local CLI', version: '1.1.0' }),
  )
  writeFileSync(join(source, 'README.md'), '# local\n', 'utf8')
  writeFileSync(join(source, 'src/index.ts'), 'export {}\n', 'utf8')

  const localDestination = join(f.root, 'local-project')
  const local = f.run(['--json', 'template', 'create', source, localDestination])
  assert.equal(local.code, 0)
  const localResult = JSON.parse(local.stdout)
  assert.equal(localResult.template.id, 'local-cli')
  assert.equal(localResult.template.sourceKind, 'local')
  assert.deepEqual(localResult.files, ['README.md', 'src/index.ts'])
  const record = JSON.parse(readFileSync(join(localDestination, '.template.json'), 'utf8'))
  assert.equal(record.templateId, 'local-cli')
  assert.equal(record.templateVersion, '1.1.0')
  assert.equal(record.sourceKind, 'local')
  assert.match(record.sourceDigest, /^sha256:/)
})

test('template create 支持相对目标、dry-run 与稳定失败', (t) => {
  const f = fixture(t)
  const dry = f.run(['--json', 'template', 'create', 'minimal', 'relative-project', '--dry-run'])
  assert.equal(dry.code, 0)
  const preview = JSON.parse(dry.stdout)
  assert.equal(preview.dryRun, true)
  assert.equal(preview.destination, join(f.root, 'relative-project'))
  assert.equal(existsSync(join(f.root, 'relative-project')), false)

  const created = f.run(['template', 'create', 'minimal', 'relative-project'])
  assert.equal(created.code, 0)
  assert.equal(existsSync(join(f.root, 'relative-project', 'README.md')), true)

  const exists = f.run(['template', 'create', 'minimal', 'relative-project'])
  assert.equal(exists.code, 2)
  assert.equal(exists.stdout, '')
  assert.match(exists.stderr, /目标已存在/)

  const missing = f.run(['template', 'create', join(f.root, 'missing'), join(f.root, 'out')])
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /找不到模板/)
})
