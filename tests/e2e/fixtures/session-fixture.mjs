import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

// 真实 DSH Session 的最小生产者：经持久化 seam 写入已校验的会话日志，不调用模型。
export const name = 'locus-session-fixture'
export const inject = ['sessionPersistence', 'sessions', 'sessionQuery', 'locusSession', 'appExit']

export function apply(ctx) {
  void (async () => {
    const cwd = process.env.LOCUS_FIXTURE_CWD
    if (cwd === undefined) throw new Error('缺少 LOCUS_FIXTURE_CWD')
    const fixture = [
      ['e2e-session-a', { cwd }, 'Fixture session A'],
      ['e2e-session-b', { cwd }, 'Fixture session B'],
      ['e2e-session-no-cwd', {}, 'Fixture session without cwd'],
    ]
    const ids = []
    for (const [id, metadata, text] of fixture) {
      const handle = await ctx.sessionPersistence.create({
        version: 4,
        id,
        createdAt: Date.now(),
        isSeeded: false,
        ...metadata,
      })
      const time = Date.now()
      await handle.append([{
        type: 'user/message',
        seq: 0,
        time,
        data: {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        },
        surfaceOp: 'append',
      }])
      await handle.flush()
      await handle.close()
      ids.push(id)
    }
    ctx.sessions.create('e2e-session-live', { meta: { cwd } })
    const live = (await ctx.get('locusSession').discover()).find((item) => item.sessionId === 'e2e-session-live')
    writeFileSync(process.env.LOCUS_FIXTURE_RESULT, JSON.stringify({ ids, live: live?.state }))
    ctx.get('appExit')(0)
  })().catch((error) => {
    writeFileSync(process.env.LOCUS_FIXTURE_RESULT, String(error?.stack ?? error))
    ctx.get('appExit')(1)
  })
}
