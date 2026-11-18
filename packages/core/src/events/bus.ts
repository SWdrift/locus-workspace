import { InvocationFailure } from '../invocation/errors.ts'
import type { EventBus, EventFilter, EventListener, EventStore, LocusEvent } from './types.ts'

export function createEventBus(store?: EventStore): EventBus {
  const listeners = new Map<string, Set<EventListener>>()
  const memory: LocusEvent[] = []
  const LIMIT = 1000
  let disposed = false

  function assertActive(): void {
    if (disposed) throw new InvocationFailure('unavailable', '事件总线已释放')
  }

  function publish(event: LocusEvent): void {
    assertActive()
    const registered = listeners.get(event.type)
    if (registered !== undefined) {
      for (const listener of [...registered]) {
        assertActive()
        try {
          listener(event)
        } catch {
          // 逐项隔离异常；事件观察不能阻断业务操作。
        }
      }
    }
    assertActive()
    memory.push(event)
    if (memory.length > LIMIT) memory.splice(0, memory.length - LIMIT)
    try {
      store?.append(event)
    } catch (error) {
      if (error instanceof InvocationFailure) throw error
      // 持久化失败不阻断业务操作，也不宣称完整审计。
    }
  }

  return Object.freeze({
    publish,
    subscribe(type: string, listener: EventListener) {
      assertActive()
      if (typeof type !== 'string' || type.length === 0 || typeof listener !== 'function') {
        throw new InvocationFailure('invalid-argument', '事件订阅需要 type 与同步监听器')
      }
      let registered = listeners.get(type)
      if (registered === undefined) {
        registered = new Set()
        listeners.set(type, registered)
      }
      registered.add(listener)
    },
    unsubscribe(type: string, listener: EventListener) {
      assertActive()
      const registered = listeners.get(type)
      if (registered === undefined) return
      registered.delete(listener)
      if (registered.size === 0) listeners.delete(type)
    },
    list(filter: EventFilter = {}) {
      assertActive()
      try {
        if (store !== undefined) return store.list(filter)
      } catch (error) {
        if (error instanceof InvocationFailure) throw error
        // 查询失败回退到进程内记录，不把持久化故障伪装成无事件。
      }
      const limit = filter.limit ?? LIMIT
      return Object.freeze(
        memory
          .filter(
            event =>
              (filter.type === undefined || event.type === filter.type) &&
              (filter.subject === undefined || event.subject === filter.subject),
          )
          .slice(-limit),
      )
    },
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      memory.length = 0
    },
  })
}
