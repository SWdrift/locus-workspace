import { z } from 'zod'

export const remoteResourceSchema = z.object({
  kind: z.string(),
  label: z.string().optional(),
})

export const remoteAuthSchema = z.object({
  method: z.enum(['key', 'private-key', 'password']),
  path: z.string().optional(),
  root: z.string().optional(),
})

export const remoteIdentitySchema = z.object({
  login: z.string(),
  auth: remoteAuthSchema,
})

export const remoteAccessSchema = z.object({
  capabilities: z.array(z.enum(['exec', 'shell'])).readonly(),
})

export const remoteTrustSchema = z.object({
  fingerprint: z.string().optional(),
  knownHosts: z.string().optional(),
})

export const remoteConnectivitySchema = z.object({
  transport: z.literal('ssh'),
  via: z.enum(['direct', 'frp']),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  remoteShell: z.enum(['posix', 'cmd']),
  client: z.string().optional(),
  trust: remoteTrustSchema.optional(),
})

export const remoteTargetSchema = z.object({
  id: z.string(),
  resource: remoteResourceSchema,
  identity: remoteIdentitySchema,
  access: remoteAccessSchema,
  connectivity: remoteConnectivitySchema,
})

export const probeResultSchema = z.object({
  targetId: z.string(),
  ok: z.boolean(),
  detail: z.string(),
  checkedAt: z.string(),
})

export const remoteTargetViewSchema = remoteTargetSchema.extend({
  lastProbe: probeResultSchema.optional(),
})

export const execResultSchema = z.object({
  targetId: z.string(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
})

export const remoteJobResultSchema = z.union([execResultSchema, z.object({ exitCode: z.number().int() })])

export const remoteServiceSchema = z.object({
  name: z.string(),
  status: z.string(),
})

export const migrationSourceSchema = z.object({
  method: z.enum(['key', 'password']),
  path: z.string(),
})

export const credentialUpdateResultSchema = z.object({
  target: z.string(),
  method: z.enum(['private-key', 'password']),
  updated: z.literal(true),
})

export const secretInputSchema = z.object({
  privateKey: z.string().optional(),
  password: z.string().optional(),
})

export const registerInputSchema = z.object({
  spec: z.string(),
  ...secretInputSchema.shape,
})

export const credentialUpdateInputSchema = z.object({
  method: z.enum(['private-key', 'password']),
  ...secretInputSchema.shape,
})
