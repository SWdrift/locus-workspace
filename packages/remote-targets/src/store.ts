import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { parseDocument, serializeDocument } from './config.ts'
import { RemoteTargetsFailure, type RemoteTarget } from './types.ts'

export interface TargetStore {
  readonly file: string
  load(): readonly RemoteTarget[]
  save(targets: readonly RemoteTarget[]): void
}

/** 目标定义以单个 YAML 文件为唯一可编辑真源；写入使用临时文件 + rename。 */
export function createTargetStore(root: string): TargetStore {
  const file = join(root, 'targets.yaml')
  return {
    file,
    load() {
      if (!existsSync(file)) return []
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch (error) {
        throw new RemoteTargetsFailure(
          'io',
          `无法读取目标配置：${error instanceof Error ? error.message : String(error)}`,
        )
      }
      return parseDocument(text)
    },
    save(targets) {
      mkdirSync(root, { recursive: true })
      const temporary = join(root, `.targets-${randomUUID()}.tmp`)
      try {
        writeFileSync(temporary, serializeDocument(targets), 'utf8')
        renameSync(temporary, file)
      } catch (error) {
        rmSync(temporary, { force: true })
        throw new RemoteTargetsFailure(
          'io',
          `无法写入目标配置：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
  }
}
