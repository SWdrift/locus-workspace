export { api, component } from './component.ts'
export { createRemoteTargetsService } from './service.ts'
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
  CredentialMigration,
  ExecResult,
  ProbeResult,
  RemoteAccess,
  RemoteAuth,
  RemoteConnectivity,
  RemoteCredentialOperation,
  RemoteCredentialSlot,
  RemoteIdentity,
  RemoteResource,
  RemoteSecurity,
  RemoteShell,
  RemoteTarget,
  RemoteTargetView,
  RemoteTargetsFailureCode,
  RemoteTargetsService,
  RemoteTrust,
  RunOptions,
  RunResult,
  TargetProtocol,
  TargetVia,
} from './types.ts'
