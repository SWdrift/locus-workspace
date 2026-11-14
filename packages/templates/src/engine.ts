import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TemplateFailure,
  type CreateTemplateOptions,
  type CreateTemplateResult,
  type TemplateInstanceRecord,
  type TemplateService,
  type TemplateSourceKind,
  type TemplateSummary,
} from './types.ts'

interface TemplateManifest {
  readonly id?: string
  readonly name?: string
  readonly version?: string
  readonly description?: string
}

type CollectedEntry =
  | { readonly kind: 'file'; readonly relative: string; readonly absolute: string; readonly bytes: Buffer }
  | { readonly kind: 'directory'; readonly relative: string; readonly absolute: string }

const EXCLUDED_NAMES: Record<string, true> = {
  '.git': true,
  node_modules: true,
  '.DS_Store': true,
  'Thumbs.db': true,
  '.template.json': true,
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TemplateFailure('invalid-template', `${field} 必须是非空字符串`)
  }
  return value.trim()
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (isMissing(error)) return false
    throw new TemplateFailure('io', `无法读取路径 ${path}：${failureMessage(error)}`)
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw new TemplateFailure('io', `无法读取路径 ${path}：${failureMessage(error)}`)
  }
}

async function readManifest(directory: string): Promise<TemplateManifest> {
  const filename = join(directory, 'template.json')
  let text: string
  try {
    text = await readFile(filename, 'utf8')
  } catch (error) {
    if (isMissing(error)) return {}
    throw new TemplateFailure('io', `无法读取 ${filename}：${failureMessage(error)}`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new TemplateFailure('invalid-template', `${filename} 不是有效 JSON：${failureMessage(error)}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TemplateFailure('invalid-template', `${filename} 必须是 JSON 对象`)
  }
  const record = value as Record<string, unknown>
  const id = optionalText(record.id, 'template.json id')
  if (id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new TemplateFailure('invalid-template', 'template.json id 只允许字母、数字、点、下划线和短横线，最长 64 字符')
  }
  const name = optionalText(record.name, 'template.json name')
  const version = optionalText(record.version, 'template.json version')
  const description = optionalText(record.description, 'template.json description')
  return {
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
    ...(version === undefined ? {} : { version }),
    ...(description === undefined ? {} : { description }),
  }
}

async function summaryFromDirectory(
  directory: string,
  sourceKind: TemplateSourceKind,
): Promise<TemplateSummary> {
  const manifest = await readManifest(directory)
  const fallback = basename(resolve(directory)) || 'template'
  const id = manifest.id ?? fallback
  const name = manifest.name ?? id
  return {
    id,
    name,
    sourceKind,
    ...(manifest.version === undefined ? {} : { version: manifest.version }),
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
  }
}

async function listBuiltinTemplates(builtinDirectory: string): Promise<readonly TemplateSummary[]> {
  let entries
  try {
    entries = await readdir(builtinDirectory, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return []
    throw new TemplateFailure('io', `无法读取内置模板目录 ${builtinDirectory}：${failureMessage(error)}`)
  }
  const summaries: TemplateSummary[] = []
  const seen = new Set<string>()
  for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    if (!entry.isDirectory()) continue
    const summary = await summaryFromDirectory(join(builtinDirectory, entry.name), 'builtin')
    if (seen.has(summary.id)) {
      throw new TemplateFailure('invalid-template', `内置模板 ID 重复：${summary.id}`)
    }
    seen.add(summary.id)
    summaries.push(summary)
  }
  return summaries.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
}

async function resolveTemplate(
  template: string,
  builtinDirectory: string,
): Promise<{ directory: string; summary: TemplateSummary }> {
  const localDirectory = resolve(template)
  if (await isDirectory(localDirectory)) {
    return {
      directory: localDirectory,
      summary: await summaryFromDirectory(localDirectory, 'local'),
    }
  }
  const bundledDirectory = join(builtinDirectory, template)
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(template) && await isDirectory(bundledDirectory)) {
    return {
      directory: bundledDirectory,
      summary: await summaryFromDirectory(bundledDirectory, 'builtin'),
    }
  }
  throw new TemplateFailure('not-found', `找不到模板：${template}`)
}

async function collectSource(directory: string): Promise<{
  entries: readonly CollectedEntry[]
  digest: string
}> {
  const entries: CollectedEntry[] = []
  const hash = createHash('sha256')

  async function visit(relativeBase: string, absoluteDirectory: string): Promise<void> {
    const children = await readdir(absoluteDirectory, { withFileTypes: true })
    children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    for (const child of children) {
      if (EXCLUDED_NAMES[child.name] === true) continue
      if (relativeBase === '' && child.name === 'template.json') continue
      const relativePath = relativeBase ? `${relativeBase}/${child.name}` : child.name
      const absolutePath = join(absoluteDirectory, child.name)
      const info = await lstat(absolutePath)
      if (info.isSymbolicLink()) {
        throw new TemplateFailure('symlink', `模板包含符号链接：${relativePath}`)
      }
      if (info.isDirectory()) {
        hash.update(`dir\0${relativePath}\0`)
        entries.push({ kind: 'directory', relative: relativePath, absolute: absolutePath })
        await visit(relativePath, absolutePath)
        continue
      }
      if (info.isFile()) {
        const bytes = await readFile(absolutePath)
        hash.update(`file\0${relativePath}\0${bytes.length}\0`)
        hash.update(bytes)
        entries.push({ kind: 'file', relative: relativePath, absolute: absolutePath, bytes })
        continue
      }
      throw new TemplateFailure('unsupported-entry', `模板包含不支持的文件类型：${relativePath}`)
    }
  }

  try {
    await visit('', directory)
  } catch (error) {
    if (error instanceof TemplateFailure) throw error
    throw new TemplateFailure('io', `无法读取模板 ${directory}：${failureMessage(error)}`)
  }
  return { entries, digest: `sha256:${hash.digest('hex')}` }
}

async function validateDestination(destination: string): Promise<string> {
  if (!isAbsolute(destination)) {
    throw new TemplateFailure('invalid-destination', '目标必须是绝对路径')
  }
  const resolved = resolve(destination)
  if (!(await isDirectory(dirname(resolved)))) {
    throw new TemplateFailure('invalid-destination', `目标父目录不存在：${dirname(resolved)}`)
  }
  if (await pathExists(resolved)) {
    throw new TemplateFailure('destination-exists', `目标已存在：${resolved}`)
  }
  return resolved
}

function instanceRecord(
  summary: TemplateSummary,
  digest: string,
  parameters: Readonly<Record<string, string>>,
): TemplateInstanceRecord {
  return {
    schema: 'locus.template-instance/v1',
    templateId: summary.id,
    ...(summary.version === undefined ? {} : { templateVersion: summary.version }),
    sourceKind: summary.sourceKind,
    sourceDigest: digest,
    createdAt: new Date().toISOString(),
    parameters,
  }
}

export async function createTemplate(
  template: string,
  options: CreateTemplateOptions,
  builtinDirectory: string,
): Promise<CreateTemplateResult> {
  const destination = await validateDestination(options.destination)
  const { directory, summary } = await resolveTemplate(template, builtinDirectory)
  const { entries, digest } = await collectSource(directory)
  const parameters = { ...(options.parameters ?? {}) }
  const files = entries.filter((entry) => entry.kind === 'file').map((entry) => entry.relative)
  const directories = entries
    .filter((entry) => entry.kind === 'directory')
    .map((entry) => entry.relative)

  if (options.dryRun === true) {
    return {
      destination,
      template: summary,
      digest,
      files,
      directories,
      metadataPath: '.template.json',
      dryRun: true,
    }
  }

  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.locus-template-${randomUUID()}`,
  )
  await mkdir(temporary)
  let moved = false
  try {
    for (const entry of entries) {
      const target = join(temporary, ...entry.relative.split('/'))
      if (entry.kind === 'directory') {
        await mkdir(target)
      } else {
        await writeFile(target, entry.bytes)
      }
    }
    const record = instanceRecord(summary, digest, parameters)
    await writeFile(
      join(temporary, '.template.json'),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf8',
    )
    if (await pathExists(destination)) {
      throw new TemplateFailure('destination-exists', `目标已存在：${destination}`)
    }
    await rename(temporary, destination)
    moved = true
  } finally {
    if (!moved) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  return {
    destination,
    template: summary,
    digest,
    files,
    directories,
    metadataPath: '.template.json',
    dryRun: false,
  }
}

export function createTemplateService(options?: {
  readonly builtinDirectory?: string
}): TemplateService {
  const builtinDirectory = resolve(
    options?.builtinDirectory ?? fileURLToPath(new URL('../templates', import.meta.url)),
  )
  return {
    list: () => listBuiltinTemplates(builtinDirectory),
    create: (template, createOptions) => createTemplate(template, createOptions, builtinDirectory),
  }
}
