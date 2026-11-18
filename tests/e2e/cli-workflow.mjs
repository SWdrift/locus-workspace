import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createLocusCore } from '../../packages/core/lib/index.js'
import { createMemoryCredentialProvider } from '../../packages/core/lib/security/index.js'

// 进程间身份恢复、挂载内模板复制、shell 与 pnpm 包装使用真实构建产物。
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI = join(REPO, 'apps/cli/lib/index.js')
const PRODUCT_VERSION = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
const root = mkdtempSync(join(tmpdir(), 'locus-cli-e2e-'))
const data = join(root, 'data')
let invocations = 0

function run(args, { code = 0, environment = {} } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    env: { ...process.env, LOCUS_FOLDER_NAME: undefined, LOCUS_HOME: data, ...environment },
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  })
  invocations++
  assert.equal(result.error, undefined)
  assert.equal(result.status, code, JSON.stringify(args) + '\n' + result.stdout + '\n' + result.stderr)
  return result
}

function json(args, options) {
  return JSON.parse(run(args, options).stdout)
}
function invoke(method, uri, body, options) {
  const envelope = json(
    ['--json', method, uri, ...(body === undefined ? [] : ['--data', JSON.stringify(body)])],
    options,
  )
  assert.equal(envelope.ok, true, JSON.stringify(envelope))
  return envelope.data
}

try {
  assert.equal(existsSync(CLI), true, '先构建 CLI')
  assert.equal(run(['version']).stdout.trim(), PRODUCT_VERSION)
  assert.match(run(['--help']).stdout, /get/)
  assert.match(run(['help', 'template://']).stdout, /template/)
  assert.equal(existsSync(data), false)

  const alpha = invoke('post', 'locus://workspaces', { name: '研究' })
  const beta = invoke('post', 'locus://workspaces', { name: '子工作区' })
  for (const workspace of [alpha, beta]) {
    assert.match(workspace.id, /^[0-9a-f-]{36}$/)
    assert.deepEqual(workspace.relations, [])
    assert.deepEqual(workspace.mounts, [])
  }
  assert.deepEqual(
    invoke('get', 'locus://workspaces').map(workspace => workspace.name),
    ['研究', '子工作区'],
  )
  assert.equal(json(['--json', 'locus://workspaces/' + alpha.id]).data.id, alpha.id)
  const renamed = invoke('patch', 'locus://workspaces/' + alpha.id, { name: '研究二' })
  assert.equal(renamed.name, '研究二')
  assert.equal(renamed.id, alpha.id)

  const mountPath = join(root, 'files')
  mkdirSync(mountPath)
  const mounted = invoke('post', 'locus://workspaces/' + alpha.id + '/mounts', { path: mountPath, name: 'files' })
  assert.equal(mounted.name, 'files')
  assert.equal(mounted.path, mountPath)
  assert.equal(invoke('get', 'locus://workspaces/' + alpha.id + '/mounts').length, 1)
  const context = json(['shell', alpha.id, '--print-env'])
  assert.equal(context.cwd, mountPath)
  assert.equal(context.environment.LOCUS_WORKSPACE_ID, alpha.id)
  assert.equal(context.environment.LOCUS_MOUNT_FILES, mountPath)
  assert.equal(JSON.parse(context.environment.LOCUS_MOUNTS).length, 1)
  assert.equal(run(['shell', alpha.id, '--command', 'locus version']).stdout.trim(), PRODUCT_VERSION)

  const generatedPath = join(mountPath, 'generated')
  const generated = invoke('post', 'template://templates/minimal/instances', { destination: generatedPath })
  assert.equal(generated.template.id, 'minimal')
  assert.equal(existsSync(join(generatedPath, '.template.json')), true)
  assert.equal(existsSync(join(generatedPath, 'template.json')), false)
  const relationUri = 'locus://workspaces/' + alpha.id + '/relations'
  const relationInput = {
    kind: 'association',
    namespace: 'locus.workspace',
    id: beta.id,
    source: { kind: 'manual', detail: 'e2e 显式输入' },
  }
  const association = invoke('post', relationUri, relationInput)
  assert.deepEqual(association.target, { namespace: 'locus.workspace', id: beta.id })
  assert.equal(invoke('post', relationUri, relationInput).id, association.id)
  const member = invoke('post', relationUri, {
    ...relationInput,
    kind: 'member',
    namespace: 'example.resource',
    id: 'external',
  })
  assert.equal(member.kind, 'member')
  assert.deepEqual(member.source, relationInput.source)
  const selfLink = json(['--json', 'post', relationUri, '--data', JSON.stringify({ ...relationInput, id: alpha.id })], {
    code: 2,
  })
  assert.equal(selfLink.ok, false)
  assert.equal(selfLink.error.code, 'conflict')
  assert.equal(invoke('get', 'locus://workspaces/' + alpha.id).relations.length, 2)
  invoke('delete', relationUri + '/' + association.id)
  const afterUnlink = invoke('get', 'locus://workspaces/' + alpha.id)
  assert.deepEqual(
    afterUnlink.relations.map(relation => relation.id),
    [member.id],
  )
  assert.equal(afterUnlink.mounts.length, 1)
  assert.ok(statSync(join(data, 'core.sqlite')).size > 0)
  invoke('delete', 'locus://workspaces/' + beta.id)
  assert.deepEqual(
    invoke('get', 'locus://workspaces').map(workspace => workspace.id),
    [alpha.id],
  )

  assert.match(run([]).stdout, /get/)
  for (const old of ['workspace', 'component', 'template', 'remote-targets', 'pg', 'credential', 'events'])
    run([old], { code: 1 })
  run(['bogus'], { code: 1 })
  invoke('post', 'locus://workspaces', { name: '相对数据目录' }, { environment: { LOCUS_HOME: 'relative-data' } })
  assert.ok(statSync(join(root, 'relative-data/core.sqlite')).size > 0)
  const empty = run(['version'], { code: 2, environment: { LOCUS_HOME: '   ' } })
  assert.match(empty.stderr, /LOCUS_HOME/)

  let host
  const core = createLocusCore({
    dataDirectory: data,
    security: {
      provider: createMemoryCredentialProvider(),
      receiveHost(value) {
        host = value
      },
    },
  })
  try {
    const password = randomUUID()
    await host.initializeRoot(password, password)
  } finally {
    await core.dispose()
  }
  const security = invoke('get', 'locus://security')
  assert.equal(security.initialized, true)
  assert.equal(invoke('get', 'locus://security').installationId, security.installationId)
  const credentialList = json(['--json', 'get', 'locus://credentials'], { code: 2 })
  assert.equal(credentialList.code, 'authentication-unavailable')
  const noninteractive = run(['--json', 'post', 'locus://security/actions/change-root-password'], { code: 2 })
  assert.ok(noninteractive.stderr.length > 0)
  assert.equal(invoke('get', 'locus://security').installationId, security.installationId)

  const pnpm = process.env.npm_execpath
  if (pnpm) {
    const wrapper = spawnSync(process.execPath, [pnpm, 'locus', 'version'], {
      cwd: REPO,
      env: { ...process.env, LOCUS_FOLDER_NAME: undefined, LOCUS_HOME: data },
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    })
    invocations++
    assert.equal(wrapper.status, 0, wrapper.stderr)
    assert.equal(wrapper.stdout.trim().split(/\r?\n/).at(-1), PRODUCT_VERSION)
    const isolated = spawnSync(
      process.execPath,
      [
        pnpm,
        'locus',
        '--profile',
        'development',
        '--json',
        'post',
        'locus://workspaces',
        '--data',
        JSON.stringify({ name: '安全开发隔离' }),
      ],
      {
        cwd: REPO,
        env: { ...process.env, LOCUS_FOLDER_NAME: 'wrapper-isolation', LOCUS_HOME: data },
        encoding: 'utf8',
        timeout: 30000,
        windowsHide: true,
      },
    )
    invocations++
    assert.equal(isolated.status, 0, isolated.stderr)
    const created = JSON.parse(isolated.stdout.trim().split(/\r?\n/).at(-1)).data
    assert.equal(
      json(['--profile', 'development', '--json', 'get', 'locus://workspaces/' + created.id], {
        environment: { LOCUS_FOLDER_NAME: 'wrapper-isolation' },
      }).data.name,
      '安全开发隔离',
    )
    assert.deepEqual(
      invoke('get', 'locus://workspaces', undefined, { environment: { LOCUS_FOLDER_NAME: 'wrapper-isolation' } }),
      [],
    )
  }
  console.log('CLI URL e2e 通过：' + invocations + ' 次调用')
} finally {
  rmSync(root, { recursive: true, force: true })
}
