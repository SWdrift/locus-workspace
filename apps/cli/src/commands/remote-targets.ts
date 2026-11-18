import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Option } from 'commander'
import type { Command } from 'commander'
import type { ComponentView } from '@locus/core/components'
import type { RemoteTarget, RemoteTargetMigrationSource } from '@locus/remote-targets'
import type { CliSecurityUI } from '../host/terminal.ts'
import { componentText, remoteTargetLine } from '../output/format.ts'
import { emit, emitJson, outputOptions, writeErr, writeOut } from '../output/output.ts'
import { pathParam } from './shared.ts'
import type { CallOperation } from './shared.ts'

interface RemoteTargetCommandsContext {
  readonly call: CallOperation
  readonly ui: CliSecurityUI
}

export function registerRemoteTargetCommands(program: Command, { call, ui }: RemoteTargetCommandsContext): void {
  const targets = program
    .command('remote-targets')
    .alias('rt')
    .description('远程目标：声明式登记 SSH 目标，经统一 operation 探测与执行')
  targets.action(async () => {
    const result = (await call('GET', 'locus://components/remote-targets')) as ComponentView
    emit(targets, result, componentText(result))
  })
  const add = targets
    .command('add <id>')
    .description('登记目标并在 Root 批准后写入配置与对应凭据字段')
    .option('--spec <path>', '配置文件；- 表示从 stdin 读取')
    .option('--file <path>', '私钥文件；私钥认证必须提供')
    .option('--credential-file <path>', '私钥文件（与 --file 等价）')
    .option('--dry-run', '只校验并输出，不写配置或凭证')
  add.action(async (id: string) => {
    const opts = add.opts<{ spec?: string; file?: string; credentialFile?: string; dryRun?: boolean }>()
    const file = credentialFile(add, opts)
    if (opts.spec === undefined) throw new Error('缺少 --spec；用 --spec <file> 或 --spec - 从 stdin 读取')
    const text = opts.spec === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(opts.spec), 'utf8')
    const preview = (await call('POST', `rt://targets/${pathParam(id)}/actions/preview`, {
      spec: text,
    })) as RemoteTarget
    const method = preview.identity.auth.method
    if (method !== 'private-key' && method !== 'password') {
      add.error('新目标必须使用 method: private-key|password', { exitCode: 1 })
      return
    }
    if (opts.dryRun === true) {
      emit(add, preview, `将登记目标 ${preview.id}\n${remoteTargetLine(preview)}`)
      return
    }
    const secret = await targetSecret(ui, method, file)
    const result = (await call('PUT', `rt://targets/${pathParam(id)}`, { spec: text }, secret)) as RemoteTarget
    emit(add, result, `已登记目标 ${id}（配置与凭证）\n${remoteTargetLine(result)}`)
  })
  const list = targets.command('list').description('列举已登记目标')
  list.action(async () => {
    const result = (await call('GET', 'rt://targets')) as RemoteTarget[]
    emit(list, result, result.map(remoteTargetLine).join('\n') || '没有远程目标。')
  })
  const show = targets.command('show <target>').description('按 id、唯一前缀或标签查看目标与最近探测')
  show.action(async (reference: string) => {
    const result = await call('GET', `rt://targets/${pathParam(reference)}`)
    emit(show, result, JSON.stringify(result, null, 2))
  })
  const update = targets
    .command('update-credential <target>')
    .alias('register')
    .description('Root 授权更新目标已绑定的私钥或密码字段；不改目标配置')
    .addOption(new Option('--method <method>', '认证方式').choices(['private-key', 'password']).makeOptionMandatory())
    .option('--file <path>', '私钥文件；私钥认证必须提供，密码认证不使用')
    .option('--credential-file <path>', '私钥文件（与 --file 等价）')
  update.action(async (reference: string) => {
    const opts = update.opts<{ method: 'private-key' | 'password'; file?: string; credentialFile?: string }>()
    const file = credentialFile(update, opts)
    const target = (await call('GET', `rt://targets/${pathParam(reference)}`)) as RemoteTarget
    if (target.identity.auth.method !== opts.method) {
      update.error('目标认证方式与 --method 不一致', { exitCode: 1 })
    }
    const secret = await targetSecret(ui, opts.method, file)
    const result = await call(
      'POST',
      `rt://targets/${pathParam(target.id)}/actions/credential`,
      { method: opts.method },
      secret,
    )
    emit(update, result, `已更新目标 ${target.id} 的 ${opts.method} 字段；目标配置未改写。`)
  })
  const migrate = targets
    .command('migrate <target>')
    .description('显式导入旧凭据文件到 Core，回读验证后切换；不删除原文件')
    .addOption(new Option('--method <method>', '旧凭据类型').choices(['private-key', 'password']).makeOptionMandatory())
    .option('--file <path>', '旧凭据文件；缺省按目标配置推导')
    .requiredOption('--yes', '确认写入 Core 并改写目标配置')
  migrate.action(async (reference: string) => {
    const opts = migrate.opts<{ method: 'private-key' | 'password'; file?: string }>()
    const source = (await call(
      'GET',
      `rt://targets/${pathParam(reference)}/actions/migration-source`,
    )) as RemoteTargetMigrationSource
    if ((source.method === 'key') !== (opts.method === 'private-key')) {
      migrate.error('--method 与旧认证方式不一致', { exitCode: 1 })
    }
    const path = opts.file === undefined ? source.path : resolve(opts.file)
    const { readCredentialFile } = await import('@locus/remote-targets')
    let secret = ''
    try {
      secret = await readCredentialFile(path)
      const result = await call(
        'POST',
        `rt://targets/${pathParam(reference)}/actions/migrate`,
        { method: opts.method },
        opts.method === 'private-key' ? { privateKey: secret } : { password: secret },
      )
      emit(migrate, result, `已迁移目标 ${reference} 到 Core 凭据绑定；原文件保留：${path}`)
    } finally {
      secret = ''
    }
  })
  const remove = targets
    .command('remove <target>')
    .description('移除目标定义，不删除目标自身')
    .requiredOption('--yes', '确认移除；不等待交互输入')
  remove.action(async (reference: string) => {
    const result = await call('DELETE', `rt://targets/${pathParam(reference)}`)
    emit(remove, result, `已移除目标 ${reference}。`)
  })
  const probe = targets.command('probe <target>').description('只读连接并执行 hostname，记录可达性')
  probe.action(async (reference: string) => {
    const result = (await call('GET', `rt://targets/${pathParam(reference)}/system`)) as { ok: boolean; detail: string }
    emit(probe, result, result.ok ? `探测成功：${result.detail}` : `探测失败：${result.detail}`)
    if (!result.ok) process.exitCode = 1
  })
  const services = targets.command('services <target>').description('列举 cmd 目标服务')
  services.action(async (reference: string) => {
    const result = (await call('GET', `rt://targets/${pathParam(reference)}/services`)) as Array<{
      name: string
      status: string
    }>
    emit(services, result, result.map(service => `${service.name}  ${service.status}`).join('\n') || '没有服务。')
  })
  const restart = targets.command('restart <target> <service>').description('重启 cmd 目标服务')
  restart.action(async (reference: string, service: string) => {
    const result = await call(
      'POST',
      `rt://targets/${pathParam(reference)}/services/${pathParam(service)}/actions/restart`,
    )
    emit(restart, result, JSON.stringify(result))
  })
  const exec = targets.command('exec <target> [command...]').description('经统一 operation 执行远端命令，退出码透传')
  exec.action(async (reference: string, command: string[] = []) => {
    const result = (await call('POST', `rt://targets/${pathParam(reference)}/jobs`, { command })) as {
      exitCode: number
      stdout: string
      stderr: string
    }
    if (outputOptions(exec).json) emitJson(exec, result)
    else {
      if (result.stdout.length > 0) writeOut(exec, result.stdout)
      if (result.stderr.length > 0) writeErr(exec, result.stderr)
    }
    if (result.exitCode !== 0) process.exitCode = result.exitCode
  })
  const shell = targets.command('shell <target>').description('打开目标交互式 Shell；继承当前终端')
  shell.action(async (reference: string) => {
    const result = (await call('POST', `rt://targets/${pathParam(reference)}/jobs`, { interactive: true })) as {
      exitCode: number
    }
    if (result.exitCode !== 0) process.exitCode = result.exitCode
  })
}

function credentialFile(
  command: Command,
  options: { readonly file?: string; readonly credentialFile?: string },
): string | undefined {
  if (options.credentialFile !== undefined && options.file !== undefined) {
    command.error('--file 与 --credential-file 只能提供一个', { exitCode: 1 })
  }
  return options.credentialFile ?? options.file
}

/** CLI 只负责可信输入；私钥合法性由写凭据的 operation 统一校验。 */
async function targetSecret(
  ui: CliSecurityUI,
  method: 'private-key' | 'password',
  file: string | undefined,
): Promise<Readonly<Record<string, string>>> {
  if (method === 'password') {
    if (file !== undefined) throw new Error('密码认证不能使用 --file')
    return { password: await ui.readSecret('SSH 密码（隐藏输入）：') }
  }
  if (file === undefined) throw new Error('私钥认证必须提供 --file')
  const { readCredentialFile } = await import('@locus/remote-targets')
  return { privateKey: await readCredentialFile(resolve(file)) }
}
