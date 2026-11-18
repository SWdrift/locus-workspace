import type { Command } from 'commander'
import { emit } from '../output/output.ts'
import type { CallOperation } from './shared.ts'

export function registerEventCommands(program: Command, call: CallOperation): void {
  const events = program.command('events').description('查询请求与领域事件')
  const list = events
    .command('list')
    .description('按 type 或 subject 查询最近事件')
    .option('--type <type>', '事件类型')
    .option('--subject <subject>', '事件 subject')
    .option('--limit <n>', '最多返回条数', '100')
  list.action(async () => {
    const opts = list.opts<{ type?: string; subject?: string; limit: string }>()
    const query = new URLSearchParams()
    if (opts.type !== undefined) query.set('type', opts.type)
    if (opts.subject !== undefined) query.set('subject', opts.subject)
    query.set('limit', opts.limit)
    const result = (await call('GET', `locus://events?${query.toString()}`)) as Array<{
      time: string
      type: string
      subject?: string
    }>
    emit(
      list,
      result,
      result.map(event => `${event.time}  ${event.type}  ${event.subject ?? '-'}`).join('\n') || '没有事件。',
    )
  })
}
