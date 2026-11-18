import { z } from 'zod'
import { defineOperation } from '../invocation/operation.ts'
import type { OperationDefinition } from '../invocation/types.ts'
import type { EventBus } from './types.ts'

const eventsQuery = z.object({
  type: z.string().optional(),
  subject: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
})
const eventOutput = z.object({
  specversion: z.literal('1.0'),
  id: z.string(),
  type: z.string(),
  source: z.string(),
  subject: z.string().optional(),
  time: z.string(),
  data: z.unknown(),
})

export function createEventOperations(events: EventBus): readonly OperationDefinition<any, any, any>[] {
  return [
    defineOperation({
      id: 'locus.events.list',
      summary: '读取持久化事件；query 可选 type、subject 精确筛选及 limit（1–10000）；无需 Body。',
      method: 'GET',
      scheme: 'locus',
      authority: 'events',
      path: '',
      auth: 'user',
      query: eventsQuery,
      input: z.undefined(),
      output: z.array(eventOutput).readonly(),
      run: query =>
        events.list({
          ...(query.type === undefined ? {} : { type: query.type }),
          ...(query.subject === undefined ? {} : { subject: query.subject }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        }),
    }),
  ]
}
