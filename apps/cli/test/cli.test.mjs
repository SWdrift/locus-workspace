import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parseComponent } from '@locus/core/components'

const CLI = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const EXAMPLES = fileURLToPath(new URL('../../../examples/components/', import.meta.url))
const PRODUCT_VERSION = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
).version

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'locus-cli-'))
  const data = join(root, 'data')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  /** 每个命令都是独立进程，跨进程恢复由文件系统与 SQLite 真实承担。 */
  const run = (args, environment = {}, input) => {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, LOCUS_FOLDER_NAME: undefined, LOCUS_HOME: data, ...environment },
      ...(input === undefined ? {} : { input }),
    })
    return {
      code: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }
  }
  return { root, data, run }
}

function data(result) {
  assert.equal(result.code, 0, result.stderr)
  const envelope = JSON.parse(result.stdout)
  assert.equal(envelope.ok, true)
  assert.equal(typeof envelope.uri, 'string')
  assert.equal(typeof envelope.requestId, 'string')
  assert.equal(typeof envelope.links, 'object')
  return envelope.data
}

test('version、静态帮助与 operation 帮助不执行业务、不创建数据目录', (t) => {
  const f = fixture(t)
  const version = f.run(['version'])
  assert.equal(version.code, 0)
  assert.equal(version.stdout, PRODUCT_VERSION)
  assert.equal(version.stderr, '')
  assert.equal(existsSync(f.data), false)

  const help = f.run(['--help'])
  assert.equal(help.code, 0)
  assert.match(help.stdout, /get/)
  assert.match(help.stdout, /pg\.database\.register/)
  assert.equal(existsSync(f.data), false)

  const registered = f.run(['help'])
  assert.equal(registered.code, 0, registered.stderr)
  assert.match(registered.stdout, /locus\.workspaces\.create/)
  assert.match(registered.stdout, /rt\.target\.register/)
  assert.equal(existsSync(f.data), false)

  const scheme = f.run(['help', 'pg://'])
  assert.equal(scheme.code, 0, scheme.stderr)
  assert.match(scheme.stdout, /pg\.database\.register/)
  assert.match(scheme.stdout, /pg\.database\.query/)
  assert.doesNotMatch(scheme.stdout, /rt\.target\.register/)

  const route = f.run(['help', 'pg://databases/app'])
  assert.equal(route.code, 0, route.stderr)
  assert.match(route.stdout, /pg\.database\.register/)
  assert.match(route.stdout, /password/)
  assert.match(route.stdout, /host/)
  assert.equal(existsSync(f.data), false)
})

test('Workspace URL 创建、裸 URI 读取与文件 Body 改名跨进程保持身份', (t) => {
  const f = fixture(t)
  const created = data(f.run([
    '--json', 'post', 'locus://workspaces', '--data', '{"name":"研究"}',
  ]))
  const id = created.id
  assert.match(id, /^[0-9a-f-]+$/)

  const workspaces = data(f.run(['--json', 'get', 'locus://workspaces']))
  assert.equal(workspaces.length, 1)
  assert.equal(workspaces[0].name, '研究')
  assert.equal(workspaces[0].id, id)

  const opened = data(f.run(['--json', `locus://workspaces/${id}`]))
  assert.equal(opened.id, id)
  assert.equal(opened.name, '研究')

  const body = join(f.root, 'rename.json')
  writeFileSync(body, '{"name":"研究二"}', 'utf8')
  const renamed = data(f.run(['--json', 'patch', `locus://workspaces/${id}`, '--file', body]))
  assert.equal(renamed.name, '研究二')
  assert.equal(renamed.id, id)
  assert.equal(data(f.run(['--json', 'get', `locus://workspaces/${id}`])).name, '研究二')
})

test('关系 Body 保持来源与幂等，拒绝自引用，DELETE 只移除关系', (t) => {
  const f = fixture(t)
  const created = data(f.run([
    '--json', 'post', 'locus://workspaces', '--data', '{"name":"关系"}',
  ]))
  const id = created.id
  const body = JSON.stringify({
    kind: 'association',
    namespace: 'example.resource',
    id: 'abc',
    source: { kind: 'manual', detail: 'CLI 显式输入' },
  })

  const linked = data(f.run([
    '--json', 'post', `locus://workspaces/${id}/relations`, '--data', body,
  ]))
  assert.equal(linked.kind, 'association')
  assert.deepEqual(linked.target, { namespace: 'example.resource', id: 'abc' })
  assert.deepEqual(linked.source, { kind: 'manual', detail: 'CLI 显式输入' })

  const repeated = data(f.run([
    '--json', 'post', `locus://workspaces/${id}/relations`, '--data', body,
  ]))
  assert.equal(repeated.id, linked.id)

  const selfLink = f.run([
    'post', `locus://workspaces/${id}/relations`, '--data',
    JSON.stringify({ kind: 'association', namespace: 'locus.workspace', id }),
  ])
  assert.equal(selfLink.code, 2)
  assert.equal(selfLink.stdout, '')
  assert.match(selfLink.stderr, /不能把自身/)

  assert.deepEqual(
    data(f.run(['--json', 'get', `locus://workspaces/${id}/relations`])),
    [linked],
  )
  const unlinked = data(f.run([
    '--json', 'delete', `locus://workspaces/${id}/relations/${linked.id}`,
  ]))
  assert.equal(unlinked.removedRelationId, linked.id)
  const remaining = data(f.run(['--json', 'get', `locus://workspaces/${id}`]))
  assert.equal(remaining.id, id)
  assert.deepEqual(remaining.relations, [])
})

test('无参数显示帮助，未知命令失败，相对数据目录按工作目录解析', (t) => {
  const f = fixture(t)
  const noCommand = f.run([])
  assert.equal(noCommand.code, 0)
  assert.match(noCommand.stdout, /get/)
  assert.equal(existsSync(f.data), false)

  const unknown = f.run(['bogus'])
  assert.equal(unknown.code, 1)
  assert.equal(unknown.stdout, '')
  assert.match(unknown.stderr, /未知命令：bogus/)

  const relative = f.run([
    '--json', 'post', 'locus://workspaces', '--data', '{"name":"相对数据目录"}',
  ], { LOCUS_HOME: 'relative-data' })
  assert.equal(relative.code, 0)
  assert.equal(existsSync(join(f.root, 'relative-data', 'core.sqlite')), true)
})

test('--human 始终覆盖 --json，--pretty 美化成功与失败信封及安全异常', (t) => {
  const f = fixture(t)
  for (const flags of [['--json', '--human'], ['--human', '--json', '--pretty']]) {
    const success = f.run([...flags, 'get', 'locus://info'])
    assert.equal(success.code, 0, success.stderr)
    assert.deepEqual(JSON.parse(success.stdout), { version: PRODUCT_VERSION })
    assert.equal(success.stderr, '')

    const missing = f.run([...flags, 'get', 'locus://workspaces/missing'])
    assert.equal(missing.code, 2)
    assert.equal(missing.stdout, '')
    assert.match(missing.stderr, /not-found/)

    const security = f.run([...flags, 'init'])
    assert.equal(security.code, 2)
    assert.equal(security.stdout, '')
    assert.match(security.stderr, /authentication-unavailable/)

    const invocation = f.run([...flags, 'get', 'locus://missing'])
    assert.equal(invocation.code, 2)
    assert.equal(invocation.stdout, '')
    assert.match(invocation.stderr, /not-found/)
  }

  const pretty = f.run(['--json', '--pretty', 'get', 'locus://workspaces/missing'])
  assert.equal(pretty.code, 2)
  assert.equal(JSON.parse(pretty.stdout).ok, false)
  assert.equal(JSON.parse(pretty.stdout).error.code, 'not-found')
  assert.match(pretty.stdout, /\n  "error": \{/)
  const prettySuccess = f.run(['--pretty', '--json', 'locus://info'])
  assert.equal(data(prettySuccess).version, PRODUCT_VERSION)
  assert.match(prettySuccess.stdout, /\n  "data": \{/)

  const security = f.run(['--json', '--pretty', 'init'])
  assert.equal(security.code, 2)
  assert.equal(JSON.parse(security.stdout).code, 'authentication-unavailable')
  assert.match(security.stdout, /^\{\n  "code":/)
})

test('URL 参数、Body 与可信文件选择错误不执行业务', (t) => {
  const f = fixture(t)
  const body = join(f.root, 'body.json')
  const secret = join(f.root, 'secret.txt')
  writeFileSync(body, '{"name":"不得创建"}', 'utf8')
  writeFileSync(secret, 'field-file-sentinel-不得输出', 'utf8')
  const invalid = [
    ['get'],
    ['post', 'locus://workspaces', 'locus://info', '--data', '{"name":"x"}'],
    ['get', 'locus://info', '--data', '{}'],
    ['post', 'locus://workspaces', '--data', '{'],
    ['post', 'locus://workspaces', '--data', '{}', '--file', body],
    ['post', 'locus://workspaces', '--file', body, '--content-type', 'text/plain'],
    ['post', 'locus://workspaces', '--field-file', `name=${secret}`],
    ['put', 'pg://databases/app', '--field-file', `unknown=${secret}`],
    ['post', 'locus://security/actions/init', '--field-file', `password=${secret}`],
    ['put', 'pg://databases/app', '--field-file', 'password'],
    ['put', 'pg://databases/app', '--field-file', `password=${secret}`, '--field-file', `password=${secret}`],
    ['put', 'pg://databases/app', '--data', '{"password":"不得混入"}', '--field-file', `password=${secret}`],
    ['put', 'pg://databases/app', '--field-file', `password=${join(f.root, 'missing')}`],
    ['put', 'pg://databases/app', '--prompt', 'unknown'],
    ['post', 'locus://workspaces', '--prompt', 'name'],
    ['put', 'pg://databases/app', '--prompt', 'password', '--prompt', 'password'],
    ['put', 'pg://databases/app', '--field-file', `password=${secret}`, '--prompt', 'password'],
  ]
  for (const args of invalid) {
    const rejected = f.run(args)
    assert.equal(rejected.code, 1, `${args.join(' ')}\n${rejected.stderr}`)
    assert.equal(rejected.stdout, '')
    assert.notEqual(rejected.stderr, '')
    assert.equal(rejected.stderr.includes('field-file-sentinel-不得输出'), false)
  }
  assert.equal(existsSync(f.data), false)

  const stdin = data(f.run([
    '--json', 'post', 'locus://workspaces', '--file', '-', '--content-type', 'application/vnd.locus+json',
  ], {}, '{"name":"标准输入"}'))
  assert.equal(stdin.name, '标准输入')
  assert.equal(data(f.run(['--json', 'get', 'locus://workspaces'])).length, 1)
})

test('读取工作目录 .env，显式环境变量优先', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.root, '.env'), 'LOCUS_HOME=env-data\nLOCUS_FOLDER_NAME=.locus\n')
  const base = { ...process.env }
  delete base.LOCUS_HOME
  delete base.LOCUS_FOLDER_NAME
  const run = (args, overrides = {}) =>
    spawnSync(process.execPath, [CLI, ...args], {
      cwd: f.root,
      encoding: 'utf8',
      env: { ...base, ...overrides },
    })

  const created = run(['--json', 'post', 'locus://workspaces', '--data', '{"name":"环境数据"}'])
  assert.equal(created.status, 0, created.stderr)
  assert.equal(existsSync(join(f.root, 'env-data', '.locus', 'core.sqlite')), true)

  const explicit = run(['--json', 'get', 'locus://workspaces'], { LOCUS_HOME: f.data })
  assert.equal(explicit.status, 0, explicit.stderr)
  assert.deepEqual(JSON.parse(explicit.stdout).data, [])
  assert.equal(existsSync(join(f.data, '.locus', 'core.sqlite')), true)
})

test('挂载目录、注入 shell 上下文，并在删除 Workspace 时清理自有记录', (t) => {
  const f = fixture(t)
  const workspace = data(f.run([
    '--json', 'post', 'locus://workspaces', '--data', '{"name":"挂载语境"}',
  ]))
  const appPath = join(f.root, 'app')
  const dataPath = join(f.root, 'data-folder')
  mkdirSync(appPath)
  mkdirSync(dataPath)

  const app = data(f.run([
    '--json', 'post', `locus://workspaces/${workspace.id}/mounts`, '--data',
    JSON.stringify({ path: appPath, name: 'app' }),
  ]))
  assert.equal(app.name, 'app')
  assert.equal(app.path, appPath)

  const mountedData = data(f.run([
    '--json', 'post', `locus://workspaces/${workspace.id}/mounts`, '--data',
    JSON.stringify({ path: dataPath }),
  ]))
  assert.equal(mountedData.name, 'data-folder')

  const duplicate = f.run([
    'post', `locus://workspaces/${workspace.id}/mounts`, '--data', JSON.stringify({ path: appPath }),
  ])
  assert.equal(duplicate.code, 2)
  assert.match(duplicate.stderr, /路径已挂载/)

  const mounted = data(f.run(['--json', 'get', `locus://workspaces/${workspace.id}/mounts`]))
  assert.deepEqual(mounted.map((mount) => mount.name), ['app', 'data-folder'])
  assert.equal(data(f.run([
    '--json', 'get', `locus://workspaces/${encodeURIComponent('挂载语境')}`,
  ])).mounts.length, 2)

  const context = JSON.parse(f.run(['shell', '挂载语境', '--print-env']).stdout)
  assert.equal(context.cwd, appPath)
  assert.equal(context.environment.LOCUS_WORKSPACE_ID, workspace.id)
  assert.equal(context.environment.LOCUS_WORKSPACE_NAME, '挂载语境')
  assert.equal(context.environment.LOCUS_WORKSPACE_ROOT, appPath)
  assert.equal(context.environment.LOCUS_MOUNT_APP, appPath)
  assert.equal(JSON.parse(context.environment.LOCUS_MOUNTS).length, 2)
  const pathValue = Object.entries(context.environment)
    .find(([key]) => key.toLowerCase() === 'path')?.[1] ?? ''
  assert.match(pathValue, /locus-shell-/)
  assert.match(context.environment.LOCUS_CLI, /index\.js$/)
  assert.deepEqual(context.missing, [])

  const shellVersion = f.run(['shell', workspace.id, '--command', 'locus version'])
  assert.equal(shellVersion.code, 0)
  assert.equal(shellVersion.stdout, PRODUCT_VERSION)
  const shellExit = f.run(['shell', workspace.id, '--command', 'exit 7'])
  assert.equal(shellExit.code, 7)

  const unmounted = data(f.run([
    '--json', 'delete', `locus://workspaces/${workspace.id}/mounts/app`,
  ]))
  assert.equal(unmounted.removedMount, 'app')
  assert.deepEqual(
    data(f.run(['--json', 'get', `locus://workspaces/${workspace.id}/mounts`])).map((mount) => mount.name),
    ['data-folder'],
  )

  const removed = data(f.run(['--json', 'delete', `locus://workspaces/${workspace.id}`]))
  assert.equal(removed.removed, true)
  assert.deepEqual(data(f.run(['--json', 'get', 'locus://workspaces'])), [])
  assert.equal(existsSync(appPath), true)
  assert.equal(existsSync(dataPath), true)
})

test('组件 URL 保持物化、动态登记、契约隔离与手动升级', (t) => {
  const f = fixture(t)
  const initial = data(f.run(['--json', 'get', 'locus://components']))
  assert.equal(initial.problems.length, 0)
  assert.equal('info' in initial.components[0], false)
  assert.equal(existsSync(join(f.data, 'components', 'remote-targets.yaml')), true)
  const materialized = readFileSync(join(f.data, 'components', 'remote-targets.yaml'), 'utf8')
  const remoteTargets = initial.components.find((component) => component.id === 'remote-targets')
  const materializedDefinition = parseComponent(materialized)
  assert.equal(materializedDefinition.version, remoteTargets.version)
  assert.doesNotMatch(materialized, /capabilities:/)
  assert.doesNotMatch(materialized, /operations:/)
  assert.doesNotMatch(materialized, /credentials:/)

  const postgres = data(f.run(['--json', 'get', 'locus://components/postgres']))
  assert.deepEqual(postgres.operations.map((operation) => operation.id), ['pg.database.register', 'pg.database.query'])
  assert.deepEqual(postgres.operations.map((operation) => operation.auth), ['root', 'user'])
  assert.deepEqual(postgres.credentials[0].fields, [
    { name: 'host', secret: false, required: true },
    { name: 'port', secret: false, required: false },
    { name: 'database', secret: false, required: true },
    { name: 'username', secret: false, required: true },
    { name: 'password', secret: true, required: true },
  ])
  assert.equal('kind' in postgres.credentials[0], false)
  assert.equal(postgres.operations.every((operation) => operation.summary.length > 0), true)
  assert.equal(postgres.operations[0].fields.password.tty, true)
  assert.equal(postgres.operations[0].fields.password.secret, true)
  const gitea = data(f.run(['--json', 'get', 'locus://components/gitea']))
  assert.equal(gitea.operations[0].id, 'gitea.repository.register')
  assert.equal(data(f.run(['--json', 'get', 'locus://components/remote-targets'])).version, remoteTargets.version)

  const template = data(f.run(['--json', 'get', 'locus://components/template']))
  assert.equal(template.id, 'template')
  assert.equal(template.source, 'package')

  const unknown = f.run(['docker'])
  assert.equal(unknown.code, 1)
  assert.match(unknown.stderr, /未知命令：docker/)

  const docker = data(f.run([
    '--json', 'post', 'locus://components', '--data',
    JSON.stringify({ path: join(EXAMPLES, 'docker.yaml') }),
  ]))
  assert.equal(docker.id, 'docker')
  assert.equal(docker.source, 'dynamic')
  assert.equal('capabilities' in docker, false)
  assert.equal('credentials' in docker, false)
  assert.match(docker.info.text, /docker --version/)

  assert.equal(data(f.run(['--json', 'get', 'locus://components/docker'])).id, 'docker')
  const viaTopLevel = f.run(['docker'])
  assert.equal(viaTopLevel.code, 1)
  assert.match(viaTopLevel.stderr, /未知命令：docker/)

  const reserved = f.run(['--json', 'post', 'locus://components', '--file', '-'], {}, JSON.stringify({ text: `id: version
version: '1'
name: version
summary: 保留 id
kind: external
probe:
  argv: [node, --version]
` }))
  assert.equal(reserved.code, 0, reserved.stderr)
  assert.equal(data(f.run(['--json', 'get', 'locus://components/version'])).id, 'version')
  assert.equal(JSON.parse(f.run(['--json', 'version']).stdout).version, PRODUCT_VERSION)

  const capabilities = f.run(['post', 'locus://components', '--file', '-'], {}, JSON.stringify({ text: `id: capability-smuggler
version: '1'
name: capability-smuggler
summary: 非法能力
kind: external
capabilities:
  - id: exec
    resourceType: server
` }))
  assert.equal(capabilities.code, 1)
  assert.match(capabilities.stderr, /capabilities/)
  const credentials = f.run(['post', 'locus://components', '--file', '-'], {}, JSON.stringify({ text: `id: credential-smuggler
version: '1'
name: credential-smuggler
summary: 非法凭据
kind: external
credentials: []
` }))
  assert.equal(credentials.code, 1)
  assert.match(credentials.stderr, /credentials/)
  const operations = f.run(['post', 'locus://components', '--data', JSON.stringify({ text: `id: operation-smuggler
version: '1'
name: operation-smuggler
summary: 非法操作
kind: external
operations: []
` })])
  assert.equal(operations.code, 1)
  assert.match(operations.stderr, /operations/)

  const file = join(f.data, 'components', 'remote-targets.yaml')
  writeFileSync(
    file,
    JSON.stringify({ ...materializedDefinition, version: 'test-outdated' }),
    'utf8',
  )
  const pending = data(f.run(['--json', 'get', 'locus://components/remote-targets']))
  assert.equal(pending.needsUpgrade, true)
  assert.equal(pending.codeVersion, remoteTargets.version)
  const upgraded = data(f.run([
    '--json', 'post', 'locus://components/remote-targets/actions/upgrade',
  ]))
  assert.equal(upgraded.needsUpgrade, false)
})

test('组件探针与部署按参数执行，remove 只对动态组件生效', (t) => {
  const f = fixture(t)
  const probeYaml = `id: probe-node
version: '1'
name: probe-node
summary: 探针组件
kind: external
probe:
  argv: [node, --version]
`
  data(f.run(['--json', 'post', 'locus://components', '--data', JSON.stringify({ text: probeYaml })]))
  const probed = data(f.run(['--json', 'post', 'locus://components/probe-node/actions/probe']))
  assert.equal(probed.external.state, 'healthy')
  const observed = data(f.run(['--json', 'get', 'locus://components/probe-node']))
  assert.equal(observed.external.state, 'healthy')
  assert.equal(observed.external.checkedAt, probed.external.checkedAt)

  const deployYaml = `id: deploy-node
version: '1'
name: deploy-node
summary: 部署组件
kind: external
deploy:
  argv: [node, --version]
`
  data(f.run(['--json', 'post', 'locus://components', '--data', JSON.stringify({ text: deployYaml })]))
  const beforeDeploy = data(f.run(['--json', 'get', 'locus://components/deploy-node']))
  assert.equal(beforeDeploy.deploy.state, 'not-deployed')
  const deployed = data(f.run(['--json', 'post', 'locus://components/deploy-node/actions/deploy']))
  assert.equal(deployed.deploy.state, 'deployed')

  const removed = data(f.run(['--json', 'delete', 'locus://components/probe-node']))
  assert.deepEqual(removed, { component: 'probe-node', removed: true })
  assert.equal(existsSync(join(f.data, 'components', 'probe-node.yaml')), false)
  const packageRemoval = f.run(['delete', 'locus://components/template'])
  assert.equal(packageRemoval.code, 2)
  assert.match(packageRemoval.stderr, /由包定义/)
})

test('未知命令及删除的领域别名均拒绝且不创建数据目录', (t) => {
  const f = fixture(t)
  for (const command of [
    'bogus', 'workspace', 'component', 'template', 'remote-targets', 'rt', 'pg', 'events', 'credential',
    'postgres', 'gitea',
  ]) {
    const unknown = f.run([command])
    assert.equal(unknown.code, 1, command)
    assert.equal(unknown.stdout, '')
    assert.match(unknown.stderr, /未知命令/)
  }
  for (const command of ['status', 'provider-status', 'change-root-password', 'operation']) {
    const unknown = f.run(['security', command])
    assert.equal(unknown.code, 1, command)
    assert.equal(unknown.stdout, '')
  }
  assert.equal(existsSync(f.data), false)
})

test('组件批量探针 URL 汇总外部状态并持久化，跳过无探针定义', (t) => {
  const f = fixture(t)
  const specs = [
    `id: bulk-up
version: '1'
name: bulk-up
summary: 可用
kind: external
probe:
  argv: [node, --version]
`,
    `id: bulk-missing
version: '1'
name: bulk-missing
summary: 缺失
kind: external
probe:
  argv: [locus-definitely-missing-binary, --version]
`,
    `id: bulk-noprobe
version: '1'
name: bulk-noprobe
summary: 无探针
kind: external
`,
  ]
  for (const spec of specs) {
    data(f.run(['--json', 'post', 'locus://components', '--data', JSON.stringify({ text: spec })]))
  }

  const payload = data(f.run(['--json', 'post', 'locus://components/actions/probe']))
  assert.deepEqual(payload.probed.map((item) => item.id).sort(), ['bulk-missing', 'bulk-up'])
  assert.equal(
    payload.probed.find((item) => item.id === 'bulk-up').external.state,
    'healthy',
  )
  assert.equal(
    payload.probed.find((item) => item.id === 'bulk-missing').external.state,
    'absent',
  )
  assert.equal(payload.skipped.length, 1)
  assert.match(payload.skipped[0].reason, /未声明探针/)

  const persisted = data(f.run(['--json', 'get', 'locus://components']))
  assert.equal(persisted.components.find((item) => item.id === 'bulk-up').external.state, 'healthy')
  assert.equal(persisted.components.find((item) => item.id === 'bulk-missing').external.state, 'absent')
  const noProbe = f.run(['--json', 'post', 'locus://components/bulk-noprobe/actions/probe'])
  assert.equal(noProbe.code, 1)
  assert.equal(JSON.parse(noProbe.stdout).error.code, 'unsupported-method')
})
