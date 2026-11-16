import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

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

function parseJson(value) {
  return JSON.parse(value)
}

test('version 与 help 不创建数据目录，退出码为 0', (t) => {
  const f = fixture(t)
  const version = f.run(['version'])
  assert.equal(version.code, 0)
  assert.equal(version.stdout, PRODUCT_VERSION)
  assert.equal(version.stderr, '')
  assert.equal(existsSync(f.data), false)

  const help = f.run(['--help'])
  assert.equal(help.code, 0)
  assert.match(help.stdout, /workspace/)
  assert.equal(existsSync(f.data), false)
})

test('Workspace 创建、列举、打开、改名与 JSON 输出跨进程保持身份', (t) => {
  const f = fixture(t)
  const created = f.run(['workspace', 'create', '研究'])
  assert.equal(created.code, 0)
  assert.match(created.stdout, /Workspace: 研究/)
  const idMatch = /Identity: ([0-9a-f-]+)/.exec(created.stdout)
  assert.ok(idMatch)
  const id = idMatch[1]

  const listed = f.run(['--json', 'workspace', 'list'])
  assert.equal(listed.code, 0)
  const workspaces = parseJson(listed.stdout)
  assert.equal(workspaces.length, 1)
  assert.equal(workspaces[0].name, '研究')
  assert.equal(workspaces[0].id, id)

  const opened = f.run(['workspace', 'open', id])
  assert.equal(opened.code, 0)
  assert.match(opened.stdout, new RegExp(`Identity: ${id}`))

  const renamed = f.run(['--json', 'workspace', 'rename', id, '研究二'])
  assert.equal(renamed.code, 0)
  assert.equal(parseJson(renamed.stdout).name, '研究二')
  assert.equal(parseJson(renamed.stdout).id, id)
})

test('显式关系幂等、拒绝自引用，解除必须确认且只移除关系', (t) => {
  const f = fixture(t)
  const created = parseJson(f.run(['--json', 'workspace', 'create', '关系']).stdout)
  const id = created.id

  const linked = parseJson(
    f.run(['--json', 'workspace', 'link', id, 'example.resource', 'abc']).stdout,
  )
  assert.equal(linked.kind, 'association')
  assert.deepEqual(linked.target, { namespace: 'example.resource', id: 'abc' })
  assert.deepEqual(linked.source, { kind: 'manual', detail: 'CLI 显式输入' })

  const repeated = parseJson(
    f.run(['--json', 'workspace', 'link', id, 'example.resource', 'abc']).stdout,
  )
  assert.equal(repeated.id, linked.id)

  const selfLink = f.run(['workspace', 'link', id, 'locus.workspace', id])
  assert.equal(selfLink.code, 2)
  assert.equal(selfLink.stdout, '')
  assert.match(selfLink.stderr, /不能把自身/)

  const missingConfirmation = f.run(['workspace', 'unlink', id, linked.id])
  assert.equal(missingConfirmation.code, 1)
  assert.equal(missingConfirmation.stdout, '')

  const unlinked = f.run(['workspace', 'unlink', id, linked.id, '--yes'])
  assert.equal(unlinked.code, 0)
  assert.match(unlinked.stdout, /外部资源未删除/)
  assert.deepEqual(parseJson(f.run(['--json', 'workspace', 'show', id]).stdout).relations, [])
})

test('无参数与未知命令给出稳定失败，相对数据目录按工作目录解析', (t) => {
  const f = fixture(t)
  const noCommand = f.run([])
  assert.equal(noCommand.code, 1)
  assert.equal(noCommand.stdout, '')

  const unknown = f.run(['bogus'])
  assert.equal(unknown.code, 1)
  assert.equal(unknown.stdout, '')
  assert.match(unknown.stderr, /未知命令：bogus/)

  const relative = f.run(['--json', 'workspace', 'create', '相对数据目录'], {
    LOCUS_HOME: 'relative-data',
  })
  assert.equal(relative.code, 0)
  assert.equal(existsSync(join(f.root, 'relative-data', 'core.sqlite')), true)
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

  const created = run(['--json', 'workspace', 'create', '环境数据'])
  assert.equal(created.status, 0, created.stderr)
  assert.equal(existsSync(join(f.root, 'env-data', '.locus', 'core.sqlite')), true)

  const explicit = run(['--json', 'workspace', 'list'], { LOCUS_HOME: f.data })
  assert.equal(explicit.status, 0, explicit.stderr)
  assert.deepEqual(JSON.parse(explicit.stdout), [])
  assert.equal(existsSync(join(f.data, '.locus', 'core.sqlite')), true)
})

test('挂载目录、注入 shell 上下文，并在删除 Workspace 时清理自有记录', (t) => {
  const f = fixture(t)
  const workspace = parseJson(f.run(['--json', 'workspace', 'create', '挂载语境']).stdout)
  const appPath = join(f.root, 'app')
  const dataPath = join(f.root, 'data-folder')
  mkdirSync(appPath)
  mkdirSync(dataPath)

  const app = parseJson(
    f.run(['--json', 'workspace', 'mount', workspace.id, appPath, '--name', 'app']).stdout,
  )
  assert.equal(app.name, 'app')
  assert.equal(app.path, appPath)

  const data = parseJson(
    f.run(['--json', 'workspace', 'mount', workspace.id, dataPath]).stdout,
  )
  assert.equal(data.name, 'data-folder')

  const duplicate = f.run(['workspace', 'mount', workspace.id, appPath])
  assert.equal(duplicate.code, 2)
  assert.match(duplicate.stderr, /路径已挂载/)

  const mounted = parseJson(f.run(['--json', 'workspace', 'mounts', workspace.id]).stdout)
  assert.deepEqual(mounted.map((mount) => mount.name), ['app', 'data-folder'])
  assert.equal(parseJson(f.run(['--json', 'workspace', 'show', '挂载语境']).stdout).mounts.length, 2)

  const context = parseJson(f.run(['shell', '挂载语境', '--print-env']).stdout)
  assert.equal(context.cwd, appPath)
  assert.equal(context.environment.LOCUS_WORKSPACE_ID, workspace.id)
  assert.equal(context.environment.LOCUS_WORKSPACE_NAME, '挂载语境')
  assert.equal(context.environment.LOCUS_WORKSPACE_ROOT, appPath)
  assert.equal(context.environment.LOCUS_MOUNT_APP, appPath)
  assert.equal(parseJson(context.environment.LOCUS_MOUNTS).length, 2)
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

  const unconfirmed = f.run(['workspace', 'unmount', workspace.id, 'app'])
  assert.equal(unconfirmed.code, 1)
  const unmounted = f.run(['workspace', 'unmount', workspace.id, 'app', '--yes'])
  assert.equal(unmounted.code, 0)
  assert.deepEqual(
    parseJson(f.run(['--json', 'workspace', 'mounts', workspace.id]).stdout).map((mount) => mount.name),
    ['data-folder'],
  )

  const removeUnconfirmed = f.run(['workspace', 'remove', workspace.id])
  assert.equal(removeUnconfirmed.code, 1)
  const removed = f.run(['workspace', 'remove', workspace.id, '--yes'])
  assert.equal(removed.code, 0)
  assert.deepEqual(parseJson(f.run(['--json', 'workspace', 'list']).stdout), [])
  assert.equal(existsSync(appPath), true)
  assert.equal(existsSync(dataPath), true)
})

test('组件：物化包定义、动态登记、顶层入口与手动升级', (t) => {
  const f = fixture(t)
  const listed = f.run(['--json', 'component', 'list'])
  assert.equal(listed.code, 0)
  const initial = parseJson(listed.stdout)
  assert.equal(initial.problems.length, 0)
  assert.equal('info' in initial.components[0], false)
  assert.equal(existsSync(join(f.data, 'components', 'remote-targets.yaml')), true)
  const materialized = readFileSync(join(f.data, 'components', 'remote-targets.yaml'), 'utf8')
  assert.match(materialized, /version: "4"/)
  assert.doesNotMatch(materialized, /capabilities:/)
  assert.doesNotMatch(materialized, /credentials:/)

  const postgres = parseJson(f.run(['--json', 'component', 'show', 'postgres']).stdout)
  assert.equal(postgres.version, '3')
  assert.deepEqual(postgres.capabilities.map((capability) => capability.id), ['register', 'list'])
  assert.deepEqual(postgres.capabilities.map((capability) => capability.resourceType), ['database', 'database'])
  assert.deepEqual(postgres.credentials[0].fields, [
    { name: 'host', secret: false, required: true },
    { name: 'port', secret: false, required: false },
    { name: 'database', secret: false, required: true },
    { name: 'username', secret: false, required: true },
    { name: 'password', secret: true, required: true },
  ])
  assert.equal('kind' in postgres.credentials[0], false)
  const postgresText = f.run(['component', 'show', 'postgres']).stdout
  assert.match(postgresText, /postgres:register/)
  assert.match(postgresText, /postgres:list/)
  assert.match(postgresText, /database-auth（host（公开，必填）, port（公开，可选）, database（公开，必填）, username（公开，必填）, password（秘密，必填））/)
  const gitea = parseJson(f.run(['--json', 'component', 'show', 'gitea']).stdout)
  assert.equal(gitea.version, '3')
  assert.equal(gitea.capabilities[0].id, 'register')
  assert.equal(parseJson(f.run(['--json', 'component', 'show', 'remote-targets']).stdout).version, '4')

  const bareTemplate = parseJson(f.run(['--json', 'template']).stdout)
  assert.equal(bareTemplate.id, 'template')
  assert.equal(bareTemplate.source, 'package')

  const unknown = f.run(['docker'])
  assert.equal(unknown.code, 1)
  assert.match(unknown.stderr, /未知命令：docker/)

  const added = f.run([
    '--json',
    'component',
    'add',
    join(EXAMPLES, 'docker.yaml'),
  ])
  assert.equal(added.code, 0, added.stderr)
  const docker = parseJson(added.stdout)
  assert.equal(docker.id, 'docker')
  assert.equal(docker.source, 'dynamic')
  assert.equal('capabilities' in docker, false)
  assert.equal('credentials' in docker, false)
  assert.match(docker.info.text, /docker --version/)

  const viaTopLevel = f.run(['--json', 'docker'])
  assert.equal(viaTopLevel.code, 0)
  assert.equal(parseJson(viaTopLevel.stdout).id, 'docker')

  const reserved = f.run(['component', 'add', '-'], {}, `id: version
version: '1'
name: version
summary: 保留 id
kind: external
probe:
  argv: [node, --version]
`)
  assert.equal(reserved.code, 2)
  assert.match(reserved.stderr, /内置顶层命令/)

  const capabilities = f.run(['component', 'add', '-'], {}, `id: capability-smuggler
version: '1'
name: capability-smuggler
summary: 非法能力
kind: external
capabilities:
  - id: exec
    resourceType: server
`)
  assert.equal(capabilities.code, 2)
  assert.match(capabilities.stderr, /capabilities/)
  const credentials = f.run(['component', 'add', '-'], {}, `id: credential-smuggler
version: '1'
name: credential-smuggler
summary: 非法凭据
kind: external
credentials: []
`)
  assert.equal(credentials.code, 2)
  assert.match(credentials.stderr, /credentials/)

  const file = join(f.data, 'components', 'remote-targets.yaml')
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace('version: "4"', 'version: "0"'),
    'utf8',
  )
  const pending = parseJson(f.run(['--json', 'component', 'show', 'remote-targets']).stdout)
  assert.equal(pending.needsUpgrade, true)
  assert.equal(pending.codeVersion, '4')
  const upgraded = f.run(['--json', 'component', 'upgrade', 'remote-targets'])
  assert.equal(upgraded.code, 0, upgraded.stderr)
  assert.equal(parseJson(upgraded.stdout).needsUpgrade, false)
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
  const added = f.run(['--json', 'component', 'add', '-'], {}, probeYaml)
  assert.equal(added.code, 0, added.stderr)
  const probed = f.run(['--json', 'component', 'probe', 'probe-node'])
  assert.equal(probed.code, 0, probed.stderr)
  assert.equal(parseJson(probed.stdout).external.state, 'healthy')
  const humanProbe = f.run(['component', 'probe', 'probe-node'])
  assert.equal(humanProbe.code, 0, humanProbe.stderr)
  assert.match(humanProbe.stdout, /^probe-node\s+healthy/)
  assert.doesNotMatch(humanProbe.stdout, /外部状态：/)
  const humanList = f.run(['component', 'list'])
  assert.match(
    humanList.stdout,
    /probe-node\s+dynamic\s+external\s+1\s+healthy\s+\d+[smhd]/,
  )

  const deployYaml = `id: deploy-node
version: '1'
name: deploy-node
summary: 部署组件
kind: external
deploy:
  argv: [node, --version]
`
  assert.equal(f.run(['component', 'add', '-'], {}, deployYaml).code, 0)
  assert.equal(f.run(['component', 'deploy', 'deploy-node']).code, 1)
  const deployed = f.run(['--json', 'component', 'deploy', 'deploy-node', '--yes'])
  assert.equal(deployed.code, 0, deployed.stderr)
  assert.equal(parseJson(deployed.stdout).deploy.state, 'deployed')

  const removed = f.run(['component', 'remove', 'probe-node', '--yes'])
  assert.equal(removed.code, 0, removed.stderr)
  assert.equal(existsSync(join(f.data, 'components', 'probe-node.yaml')), false)
  const packageRemoval = f.run(['component', 'remove', 'template', '--yes'])
  assert.equal(packageRemoval.code, 2)
  assert.match(packageRemoval.stderr, /由包定义/)
})

test('未知顶层命令不创建数据目录', (t) => {
  const f = fixture(t)
  const unknown = f.run(['bogus'])
  assert.equal(unknown.code, 1)
  assert.match(unknown.stderr, /未知命令：bogus/)
  assert.equal(existsSync(f.data), false)
})

test('component probe --all 汇总外部组件状态并跳过无探针定义', (t) => {
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
    assert.equal(f.run(['component', 'add', '-'], {}, spec).code, 0)
  }

  const all = f.run(['--json', 'component', 'probe', '--all'])
  assert.equal(all.code, 1)
  const payload = parseJson(all.stdout)
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

  const human = f.run(['component', 'probe', '--all'])
  assert.equal(human.code, 1)
  assert.match(human.stdout, /bulk-up\s+healthy/)
  assert.match(human.stdout, /bulk-missing\s+absent/)
  assert.match(human.stdout, /bulk-noprobe\s+跳过/)

  assert.equal(f.run(['component', 'probe']).code, 1)
  assert.equal(f.run(['component', 'probe', 'bulk-up', '--all']).code, 1)
})
