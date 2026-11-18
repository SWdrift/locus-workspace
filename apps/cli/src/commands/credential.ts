import type { Command } from 'commander'
import { emit } from '../output/output.ts'
import { pathParam } from './shared.ts'
import type { CallOperation } from './shared.ts'

export function registerCredentialCommands(program: Command, call: CallOperation): void {
  const credential = program.command('credential').description('Root 诊断与清理；普通使用请走组件 operation')
  const providerStatus = credential.command('provider-status').description('查询 Provider 装配与后端声明，不读取秘密')
  providerStatus.action(async () => {
    const result = await call('GET', 'locus://security/provider')
    emit(providerStatus, result, JSON.stringify(result))
  })
  const list = credential.command('list').description('只列举当前 Profile 的凭据元数据与公开字段')
  list.action(async () => {
    const result = (await call('GET', 'locus://credentials')) as {
      credentials: Array<{ reference: string; providerId: string; fields: Record<string, string> }>
    }
    emit(
      list,
      result.credentials,
      result.credentials
        .map(item => `${item.reference}  ${item.providerId}  ${Object.keys(item.fields).join(',') || '-'}`)
        .join('\n') || '没有凭据。',
    )
  })
  const bindings = credential.command('bindings').description('列举 component + slot + resourceKey 绑定')
  bindings.action(async () => {
    const result = (await call('GET', 'locus://credentials')) as {
      bindings: Array<{ componentId: string; slot: string; resourceKey: string; reference: string }>
    }
    emit(
      bindings,
      result.bindings,
      result.bindings
        .map(item => `${item.componentId}  ${item.slot}  ${item.resourceKey}  -> ${item.reference}`)
        .join('\n') || '没有绑定。',
    )
  })
  const status = credential.command('status <ref>').description('检查凭据元数据与 Provider 条目；不输出秘密')
  status.action(async (reference: string) => {
    const result = (await call('POST', 'locus://credentials/actions/status', { reference })) as {
      metadata: { reference: string }
      present: boolean
    }
    emit(status, result, `${result.metadata.reference}  ${result.present ? '存在' : '缺失'}`)
  })
  const remove = credential.command('remove <ref>').description('Root 授权删除指定凭据与其全部绑定')
  remove.action(async (reference: string) => {
    const result = (await call('GET', 'locus://credentials')) as {
      bindings: Array<{ componentId: string; slot: string; resourceKey: string; reference: string }>
    }
    const first = result.bindings.find(item => item.reference === reference)
    if (first === undefined) {
      remove.error(`找不到凭据绑定：${reference}`, { exitCode: 2 })
      return
    }
    await call(
      'DELETE',
      `locus://credentials/${pathParam(first.componentId)}/${pathParam(first.slot)}/${pathParam(first.resourceKey)}`,
    )
    emit(remove, { reference, removed: true }, `已删除凭据 ${reference} 及其绑定。`)
  })
  const cleanup = credential
    .command('cleanup')
    .description('Root 检查未登记元数据的孤立条目；--yes 才删除')
    .option('--yes', '确认删除孤立条目')
  cleanup.action(async () => {
    const apply = cleanup.opts<{ yes?: boolean }>().yes === true
    const result = (await call('POST', 'locus://credentials/actions/cleanup', { apply })) as {
      service: string
      orphans: readonly string[]
      removed: number
      remaining: number
    }
    const detail =
      result.orphans.length === 0
        ? `service ${result.service} 没有孤立条目。`
        : `${apply ? '已删除' : '发现'} ${result.orphans.length} 个孤立条目：${result.orphans.join(', ')}；剩余 ${result.remaining}。`
    emit(cleanup, result, detail)
  })
}
