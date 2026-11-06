/** Locus 运行时的公开身份信息。 */
export interface LocusInfo {
  /** 面向客户端与诊断的产品版本。 */
  readonly version: string
}

/** DSH 宿主适配器暴露给 Locus 插件的服务。 */
export interface LocusService {
  readonly info: LocusInfo
}
