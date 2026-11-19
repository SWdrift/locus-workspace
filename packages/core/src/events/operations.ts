import { z } from 'zod'
import { i18n } from '../i18n/core.ts'
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
      summary: i18n.t('operation.events.list'),
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
