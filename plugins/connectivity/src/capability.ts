import type { CapabilityDescriptor } from '@locus/contracts'

/** 提供方声明；Tag 只用于分类，不代表权限或当前可达性。 */
export const capability: CapabilityDescriptor = Object.freeze({
  id: 'locus.connectivity',
  provider: '@locus/connectivity',
  tags: Object.freeze(['connectivity']),
})
