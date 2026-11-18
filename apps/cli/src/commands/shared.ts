import type { LocusMethod } from '@locus/core/invocation'
import type { CliApi } from '../host/api.ts'

export type CallOperation = (
  method: LocusMethod,
  uri: string,
  body?: unknown,
  trustedInput?: Readonly<Record<string, unknown>>,
) => Promise<unknown>

export type WithCliApi = <T>(action: (api: CliApi) => Promise<T>) => Promise<T>

export function pathParam(value: string): string {
  return encodeURIComponent(value)
}
