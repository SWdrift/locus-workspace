import type { LocusInfo, LocusService } from '@locus/contracts'

/** Locus 产品版本，也是唯一来源。 */
export const LOCUS_VERSION = '0.0.0'

/** 由宿主适配器持有并释放的 core 句柄。 */
export interface LocusCore extends LocusService {
  readonly info: LocusInfo
  dispose(): Promise<void>
}

/** 创建进程内 Locus core；它不持有宿主或传输层状态。 */
export function createLocusCore(): LocusCore {
  const info: LocusInfo = Object.freeze({ version: LOCUS_VERSION })
  return {
    info,
    async dispose() {},
  }
}
