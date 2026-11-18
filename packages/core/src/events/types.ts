export interface LocusEvent {
  readonly specversion: '1.0'
  readonly id: string
  readonly type: string
  readonly source: string
  readonly subject?: string
  readonly time: string
  readonly data: unknown
}

export interface EventFilter {
  readonly type?: string
  readonly subject?: string
  readonly limit?: number
}

/** 事件持久化端口；总线隔离存储故障，已释放状态必须明确拒绝。 */
export interface EventStore {
  append(event: LocusEvent): void
  list(filter?: EventFilter): readonly LocusEvent[]
  dispose?(): void
}

/** 返回 undefined 而非 void，防止把 async 函数误注册为同步监听器。 */
export type EventListener = (event: LocusEvent) => undefined

export interface EventBus {
  publish(event: LocusEvent): void
  subscribe(type: string, listener: EventListener): void
  unsubscribe(type: string, listener: EventListener): void
  list(filter?: EventFilter): readonly LocusEvent[]
  /** 终态释放订阅与内存记录；持久化端口由其所有者单独释放。 */
  dispose(): void
}
