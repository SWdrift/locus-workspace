import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { i18n } from './i18n.ts'
import { TemplateFailure } from './types.ts'
import type {
  CreateTemplateOptions,
  CreateTemplateResult,
  RegisterTemplateInput,
  TemplateDetail,
  TemplateList,
  TemplateProblem,
  TemplateService,
  TemplateSourceKind,
  TemplateSummary,
  UpdateTemplateMetadataInput,
} from './types.ts'

interface TemplateMetadata {
  readonly schema: 'locus.template/v1'
  readonly id: string
  readonly name: string
  readonly version?: string
  readonly description?: string
}

type CollectedEntry =
  | { readonly kind: 'file'; readonly relative: string; readonly absolute: string; readonly bytes: Buffer }
  | { readonly kind: 'directory'; readonly relative: string; readonly absolute: string }

const METADATA_NAME = '.template.json'
const METADATA_SCHEMA = 'locus.template/v1'
const TEMPLATE_ID = /^[a-z][a-z0-9-]{0,63}$/
const METADATA_KEYS: Readonly<Record<string, true>> = {
  schema: true,
  id: true,
  name: true,
  version: true,
  description: true,
}

const EXCLUDED_NAMES: Readonly<Record<string, true>> = {
  '.git': true,
  node_modules: true,
  '.DS_Store': true,
  'Thumbs.db': true,
  [METADATA_NAME]: true,
}

interface TemplateServiceOptions {
  readonly dataDirectory: string
  readonly builtinDirectory?: string
}

/** 模板库解析、元信息读写与纯复制；不缓存磁盘内容。 */
export function createTemplateService(options: TemplateServiceOptions): TemplateService {
  const dataDirectory = resolve(options.dataDirectory)
  const builtinDirectory = resolve(options.builtinDirectory ?? fileURLToPath(new URL('../templates', import.meta.url)))
  const storeDirectory = join(dataDirectory, 'templates')

  return {
    list: () => listTemplates(storeDirectory, builtinDirectory),
    detail: id => detailTemplate(storeDirectory, builtinDirectory, id),
    register: input => registerTemplate(storeDirectory, builtinDirectory, input),
    updateMetadata: (id, input) => updateMetadata(storeDirectory, builtinDirectory, id, input),
    remove: id => removeTemplate(storeDirectory, builtinDirectory, id),
    create: (id, createOptions) => createInstance(storeDirectory, builtinDirectory, id, createOptions),
  }
}

async function listTemplates(storeDirectory: string, builtinDirectory: string): Promise<TemplateList> {
  const problems: TemplateProblem[] = []
  const templates: TemplateSummary[] = []
  const userIds = new Set<string>()

  for (const entry of await readTemplateDirectories(storeDirectory, 'store')) {
    const directory = join(storeDirectory, entry.name)
    try {
      if (!TEMPLATE_ID.test(entry.name)) {
        throw new TemplateFailure('invalid-id', i18n.t('engine.id-invalid'))
      }
      const metadata = await readMetadata(directory, entry.name)
      userIds.add(entry.name)
      templates.push(summaryFromMetadata(metadata, 'user'))
    } catch (error) {
      problems.push(problemFrom(entry.name, directory, error))
    }
  }

  for (const entry of await readTemplateDirectories(builtinDirectory, 'builtin')) {
    if (userIds.has(entry.name)) continue
    const directory = join(builtinDirectory, entry.name)
    try {
      if (!TEMPLATE_ID.test(entry.name)) {
        throw new TemplateFailure('invalid-id', i18n.t('engine.id-invalid'))
      }
      const metadata = await readMetadata(directory, entry.name)
      templates.push(summaryFromMetadata(metadata, 'builtin'))
    } catch (error) {
      problems.push(problemFrom(entry.name, directory, error))
    }
  }

  templates.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  problems.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  return { templates, problems }
}

async function readTemplateDirectories(
  directory: string,
  label: 'store' | 'builtin',
): Promise<readonly { readonly name: string }[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return []
    throw new TemplateFailure(
      'io',
      i18n.t(label === 'store' ? 'engine.read-store-dir-failed' : 'engine.read-builtin-dir-failed', {
        directory,
        detail: failureMessage(error),
      }),
    )
  }
  return entries.filter(entry => entry.isDirectory())
}

async function detailTemplate(storeDirectory: string, builtinDirectory: string, id: string): Promise<TemplateDetail> {
  requireTemplateId(id)
  const { directory, metadata, sourceKind } = await resolveTemplate(storeDirectory, builtinDirectory, id)
  const { entries, digest } = await collectSource(directory)
  return {
    ...summaryFromMetadata(metadata, sourceKind),
    digest,
    fileCount: entries.filter(entry => entry.kind === 'file').length,
    directoryCount: entries.filter(entry => entry.kind === 'directory').length,
  }
}

async function registerTemplate(
  storeDirectory: string,
  builtinDirectory: string,
  input: RegisterTemplateInput,
): Promise<TemplateDetail> {
  requireTemplateId(input.id)
  const target = join(storeDirectory, input.id)
  if (await pathExists(target)) {
    throw new TemplateFailure('template-exists', i18n.t('engine.template-exists', { id: input.id }))
  }

  const source = await resolveSource(builtinDirectory, input)
  const sourceMetadata = await readMetadataOrUndefined(source.directory, source.sourceId)
  const metadata = normalizeMetadata(input.id, sourceMetadata, source.kind, source.sourceId)
  const { entries } = await collectSource(source.directory)
  await mkdir(storeDirectory, { recursive: true })
  const temporary = join(storeDirectory, `.${input.id}.${randomUUID()}`)
  let moved = false
  try {
    await mkdir(temporary)
    for (const entry of entries) {
      const destination = join(temporary, ...entry.relative.split('/'))
      if (entry.kind === 'directory') {
        await mkdir(destination)
      } else {
        await writeFile(destination, entry.bytes)
      }
    }
    await writeMetadata(temporary, metadata)
    await rename(temporary, target)
    moved = true
  } finally {
    if (!moved) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  return detailTemplate(storeDirectory, builtinDirectory, input.id)
}

async function updateMetadata(
  storeDirectory: string,
  builtinDirectory: string,
  id: string,
  input: UpdateTemplateMetadataInput,
): Promise<TemplateDetail> {
  requireTemplateId(id)
  const directory = join(storeDirectory, id)
  if (!(await isDirectory(directory))) {
    if (await isDirectory(join(builtinDirectory, id))) {
      throw new TemplateFailure('template-builtin', i18n.t('engine.template-builtin', { id }))
    }
    throw new TemplateFailure('not-found', i18n.t('engine.template-not-found', { template: id }))
  }

  const current = await readMetadata(directory, id)
  const version = optionalMetadataText(input.version, current.version, 'version', 64)
  const description = optionalMetadataText(input.description, current.description, 'description', 500)
  const metadata: TemplateMetadata = {
    schema: METADATA_SCHEMA,
    id,
    name: input.name === undefined ? current.name : requireMetadataText(input.name, 'name', 100),
    ...(version === undefined ? {} : { version }),
    ...(description === undefined ? {} : { description }),
  }
  await writeMetadata(directory, metadata)
  return detailTemplate(storeDirectory, builtinDirectory, id)
}

async function removeTemplate(storeDirectory: string, builtinDirectory: string, id: string): Promise<void> {
  requireTemplateId(id)
  const directory = join(storeDirectory, id)
  if (!(await isDirectory(directory))) {
    if (await isDirectory(join(builtinDirectory, id))) {
      throw new TemplateFailure('template-builtin', i18n.t('engine.template-builtin', { id }))
    }
    throw new TemplateFailure('not-found', i18n.t('engine.template-not-found', { template: id }))
  }
  await rm(directory, { recursive: true })
}

async function createInstance(
  storeDirectory: string,
  builtinDirectory: string,
  id: string,
  options: CreateTemplateOptions,
): Promise<CreateTemplateResult> {
  requireTemplateId(id)
  const destination = await validateDestination(options.destination)
  const { directory, metadata, sourceKind } = await resolveTemplate(storeDirectory, builtinDirectory, id)
  const { entries, digest } = await collectSource(directory)
  const files = entries.filter(entry => entry.kind === 'file').map(entry => entry.relative)
  const directories = entries.filter(entry => entry.kind === 'directory').map(entry => entry.relative)
  const summary = summaryFromMetadata(metadata, sourceKind)

  if (options.dryRun === true) {
    return { destination, template: summary, digest, files, directories, dryRun: true }
  }

  const temporary = join(dirname(destination), `.${basename(destination)}.locus-template-${randomUUID()}`)
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
    if (await pathExists(destination)) {
      throw new TemplateFailure('destination-exists', i18n.t('engine.destination-exists', { destination }))
    }
    await rename(temporary, destination)
    moved = true
  } finally {
    if (!moved) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  return { destination, template: summary, digest, files, directories, dryRun: false }
}

async function resolveTemplate(
  storeDirectory: string,
  builtinDirectory: string,
  id: string,
): Promise<{ directory: string; metadata: TemplateMetadata; sourceKind: TemplateSourceKind }> {
  const userDirectory = join(storeDirectory, id)
  if (await isDirectory(userDirectory)) {
    return {
      directory: userDirectory,
      metadata: await readMetadata(userDirectory, id),
      sourceKind: 'user',
    }
  }
  const builtin = join(builtinDirectory, id)
  if (await isDirectory(builtin)) {
    return {
      directory: builtin,
      metadata: await readMetadata(builtin, id),
      sourceKind: 'builtin',
    }
  }
  throw new TemplateFailure('not-found', i18n.t('engine.template-not-found', { template: id }))
}

async function resolveSource(
  builtinDirectory: string,
  input: RegisterTemplateInput,
): Promise<{ directory: string; sourceId: string; kind: 'path' | 'builtin' }> {
  if (input.source.kind === 'path') {
    const directory = resolve(input.source.path)
    if (!(await isDirectory(directory))) {
      throw new TemplateFailure('invalid-source', i18n.t('engine.source-not-found', { path: directory }))
    }
    return { directory, sourceId: input.id, kind: 'path' }
  }
  requireTemplateId(input.source.id)
  const directory = join(builtinDirectory, input.source.id)
  if (!(await isDirectory(directory))) {
    throw new TemplateFailure('not-found', i18n.t('engine.template-not-found', { template: input.source.id }))
  }
  return { directory, sourceId: input.source.id, kind: 'builtin' }
}

function normalizeMetadata(
  id: string,
  source: TemplateMetadata | undefined,
  sourceKind: 'path' | 'builtin',
  sourceId: string,
): TemplateMetadata {
  const name = source?.name ?? (sourceKind === 'builtin' ? sourceId : id)
  return {
    schema: METADATA_SCHEMA,
    id,
    name: requireMetadataText(name, 'name', 100),
    ...(source?.version === undefined ? {} : { version: requireMetadataText(source.version, 'version', 64) }),
    ...(source?.description === undefined
      ? {}
      : { description: requireMetadataText(source.description, 'description', 500) }),
  }
}

async function readMetadata(directory: string, expectedId: string): Promise<TemplateMetadata> {
  const metadata = await readMetadataOrUndefined(directory, expectedId)
  if (metadata === undefined) {
    return { schema: METADATA_SCHEMA, id: expectedId, name: expectedId }
  }
  return metadata
}

async function readMetadataOrUndefined(directory: string, expectedId: string): Promise<TemplateMetadata | undefined> {
  const filename = join(directory, METADATA_NAME)
  let text: string
  try {
    text = await readFile(filename, 'utf8')
  } catch (error) {
    if (isMissing(error)) return undefined
    throw new TemplateFailure(
      'io',
      i18n.t('engine.read-file-failed', { file: filename, detail: failureMessage(error) }),
    )
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new TemplateFailure(
      'invalid-template',
      i18n.t('engine.invalid-json', { file: filename, detail: failureMessage(error) }),
    )
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TemplateFailure('invalid-template', i18n.t('engine.json-object-required', { file: filename }))
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (METADATA_KEYS[key] !== true) {
      throw new TemplateFailure('invalid-template', i18n.t('engine.metadata-unknown-field', { field: key }))
    }
  }
  if (record.schema !== undefined && record.schema !== METADATA_SCHEMA) {
    throw new TemplateFailure('invalid-template', i18n.t('engine.metadata-schema', { schema: String(record.schema) }))
  }
  const id = record.id === undefined ? expectedId : requireMetadataText(record.id, 'id', 64)
  if (!TEMPLATE_ID.test(id) || id !== expectedId) {
    throw new TemplateFailure(
      'invalid-template',
      i18n.t('engine.metadata-id-mismatch', { expected: expectedId, actual: id }),
    )
  }
  const name = record.name === undefined ? id : requireMetadataText(record.name, 'name', 100)
  const version = record.version === undefined ? undefined : requireMetadataText(record.version, 'version', 64)
  const description =
    record.description === undefined ? undefined : requireMetadataText(record.description, 'description', 500)
  return {
    schema: METADATA_SCHEMA,
    id,
    name,
    ...(version === undefined ? {} : { version }),
    ...(description === undefined ? {} : { description }),
  }
}

async function writeMetadata(directory: string, metadata: TemplateMetadata): Promise<void> {
  const temporary = join(directory, `.${METADATA_NAME}.${randomUUID()}`)
  await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  await rename(temporary, join(directory, METADATA_NAME))
}

function summaryFromMetadata(metadata: TemplateMetadata, sourceKind: TemplateSourceKind): TemplateSummary {
  return {
    id: metadata.id,
    name: metadata.name,
    sourceKind,
    ...(metadata.version === undefined ? {} : { version: metadata.version }),
    ...(metadata.description === undefined ? {} : { description: metadata.description }),
  }
}

function requireTemplateId(value: string): string {
  if (!TEMPLATE_ID.test(value)) {
    throw new TemplateFailure('invalid-id', i18n.t('engine.id-invalid'))
  }
  return value
}

function requireMetadataText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > max) {
    throw new TemplateFailure('invalid-template', i18n.t('engine.metadata-field-invalid', { field, max: String(max) }))
  }
  return value.trim()
}

function optionalMetadataText(
  value: string | undefined,
  current: string | undefined,
  field: string,
  max: number,
): string | undefined {
  if (value === undefined) return current
  if (value.trim().length === 0) return undefined
  return requireMetadataText(value, field, max)
}

function problemFrom(id: string, path: string, error: unknown): TemplateProblem {
  return {
    id,
    path,
    message: error instanceof Error ? error.message : String(error),
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (isMissing(error)) return false
    throw new TemplateFailure('io', i18n.t('engine.read-path-failed', { path, detail: failureMessage(error) }))
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw new TemplateFailure('io', i18n.t('engine.read-path-failed', { path, detail: failureMessage(error) }))
  }
}

async function collectSource(directory: string): Promise<{
  entries: readonly CollectedEntry[]
  digest: string
}> {
  const entries: CollectedEntry[] = []
  const hash = createHash('sha256')

  async function visit(relativeBase: string, absoluteDirectory: string): Promise<void> {
    const children = await readdir(absoluteDirectory, { withFileTypes: true })
    children.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const child of children) {
      if (EXCLUDED_NAMES[child.name] === true) continue
      if (relativeBase === '' && child.name === 'template.json') continue
      const relativePath = relativeBase ? `${relativeBase}/${child.name}` : child.name
      const absolutePath = join(absoluteDirectory, child.name)
      const info = await lstat(absolutePath)
      if (info.isSymbolicLink()) {
        throw new TemplateFailure('symlink', i18n.t('engine.symlink', { path: relativePath }))
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
      throw new TemplateFailure('unsupported-entry', i18n.t('engine.unsupported-entry', { path: relativePath }))
    }
  }

  try {
    await visit('', directory)
  } catch (error) {
    if (error instanceof TemplateFailure) throw error
    throw new TemplateFailure('io', i18n.t('engine.read-template-failed', { directory, detail: failureMessage(error) }))
  }
  return { entries, digest: `sha256:${hash.digest('hex')}` }
}

async function validateDestination(destination: string): Promise<string> {
  if (!isAbsolute(destination)) {
    throw new TemplateFailure('invalid-destination', i18n.t('engine.destination-absolute'))
  }
  const resolved = resolve(destination)
  if (!(await isDirectory(dirname(resolved)))) {
    throw new TemplateFailure('invalid-destination', i18n.t('engine.parent-missing', { directory: dirname(resolved) }))
  }
  if (await pathExists(resolved)) {
    throw new TemplateFailure('destination-exists', i18n.t('engine.destination-exists', { destination: resolved }))
  }
  return resolved
}
