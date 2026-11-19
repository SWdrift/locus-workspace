export { component, operations } from './component.ts'
export { i18n } from './i18n.ts'
export { createRemoteTargetsService } from './service.ts'
export { parseAddSpecText, targetBinding } from './config.ts'
export { RemoteTargetsFailure } from './types.ts'
export { readCredentialFile, assertUnencryptedPrivateKey } from './credentials.ts'
export { createCommandRunner } from './runner.ts'
export type {
  AddOptions,
  AuthMethod,
  Capability,
  CommandRunner,
  ComponentAvailability,
  ComponentGate,
  ExecResult,
  ProbeResult,
  RemoteAccess,
  RemoteAuth,
  RemoteConnectivity,
  RemoteCredentialMaterial,
  RemoteCredentialSlot,
  RemoteCredentialUpdateResult,
  RemoteIdentity,
  RemoteJobResult,
  RemoteResource,
  RemoteShell,
  RemoteService,
  RemoteTarget,
  RemoteTargetMigrationSource,
  RemoteTargetView,
  RemoteTargetsFailureCode,
  RemoteTargetsService,
  RemoteTrust,
  RunOptions,
  RunResult,
  TargetProtocol,
  TargetVia,
} from './types.ts'
