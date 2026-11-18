import { z } from 'zod'
import {
  defineOperation, describeOperation,
  type InputField, type OperationContext, type OperationDescription, type OperationMetadata,
} from '../lib/invocation/index.js'
import type { EventListener } from '../lib/events/index.js'

const operation = defineOperation({
  id: 'example.list', method: 'GET', scheme: 'example', authority: 'items', path: '', auth: 'user',
  summary: '读取示例列表；query 提供 limit，Body 提供 prefix。',
  fields: { prefix: { description: '筛选前缀。', required: true } },
  query: z.object({ limit: z.coerce.number() }),
  input: z.object({ prefix: z.string() }),
  output: z.object({ label: z.string(), count: z.number() }),
  run: (query, input) => ({ label: input.prefix, count: query.limit }),
})

const metadata: OperationMetadata = operation
const description: OperationDescription = describeOperation(metadata, 'example')
const field: InputField | undefined = description.fields?.prefix
const required: boolean | undefined = field?.required
void required
// @ts-expect-error 公开发现元数据不携带可执行 handler。
description.run
// @ts-expect-error 字段元数据的 required 只能是布尔值。
const invalidField: InputField = { required: 'true' }
void invalidField
const fileField: InputField = { tty: true, file: true, secret: true, description: '允许可信文件输入。' }
void fileField
// @ts-expect-error 文件来源标记只能是布尔值。
const invalidFileField: InputField = { file: 'true' }
void invalidFileField

// 验证消费方得到 schema 的输出类型，而非 unknown 或输入转换前的类型。
declare const result: Awaited<ReturnType<typeof operation.run>>
declare const context: OperationContext
const count: number = result.count
void count
// @ts-expect-error query 转换后的 limit 必须是 number。
operation.run({ limit: '1' }, { prefix: 'x' }, context)
// @ts-expect-error output 的字段类型必须传递到消费方。
const invalidCount: string = result.count
void invalidCount

defineOperation({
  id: 'example.bad', method: 'GET', scheme: 'example', authority: 'items', path: '', auth: 'user',
  input: z.undefined(), output: z.object({ count: z.number() }),
  // @ts-expect-error handler 输出必须匹配 output，不能反过来把 schema 类型拓宽。
  run: () => ({ count: 'wrong' }),
})

// @ts-expect-error 本轮事件监听器不支持异步返回。
const asyncListener: EventListener = async () => {}
void asyncListener
