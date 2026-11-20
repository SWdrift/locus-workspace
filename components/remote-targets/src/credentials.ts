import { constants } from 'node:fs'
import { execa } from 'execa'
import { chmod, lstat, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import { DomainFailure, InvocationFailure } from '@locus/core/invocation'
import { SecurityFailure } from '@locus/core/security'
import { i18n } from './i18n.ts'
import { RemoteTargetsFailure } from './types.ts'
import { createCommandRunner } from './runner.ts'

const MAX_CREDENTIAL_BYTES = 1024 * 1024
const ACL_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$j=[Console]::In.ReadToEnd() | ConvertFrom-Json
try {
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $allowed=@($sid.Value,'S-1-5-18','S-1-5-32-544')
  foreach($p in $j.paths) {
    if ($p.directory) { $acl=New-Object Security.AccessControl.DirectorySecurity } else { $acl=New-Object Security.AccessControl.FileSecurity }
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true,$false)
    foreach($value in $allowed) {
      $identity=New-Object Security.Principal.SecurityIdentifier($value)
      if($p.directory) { $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow') }
      else { $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow') }
      $acl.AddAccessRule($rule)
    }
    if($p.directory) { [IO.Directory]::SetAccessControl($p.path,$acl); $actual=[IO.Directory]::GetAccessControl($p.path) }
    else { [IO.File]::SetAccessControl($p.path,$acl); $actual=[IO.File]::GetAccessControl($p.path) }
    if(!$actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'acl' }
    $seen=@{}
    foreach($rule in $actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
      $value=$rule.IdentityReference.Value
      if($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or $allowed -notcontains $value -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'acl' }
      $seen[$value]=$true
    }
    foreach($value in $allowed) { if(!$seen[$value]) { throw 'acl' } }
  }
  [Console]::Out.Write('verified')
} catch { exit 1 }
`

interface AclTarget {
  readonly path: string
  readonly directory: boolean
}

/** 准备、消费和清理分别分类；清理失败不能覆盖远端已经完成的事实。 */
export async function withCredentialFile<T>(secret: string, consume: (path: string) => Promise<T>): Promise<T> {
  let directory: string | undefined
  let path!: string
  let buffer: Buffer | undefined
  let failure: Error | undefined
  let result: T | undefined
  try {
    directory = await mkdtemp(join(tmpdir(), 'locus-remote-'))
    path = join(directory, 'credential')
    const file = await open(path, 'wx', 0o600)
    try {
      await permissions([
        { path: directory, directory: true },
        { path, directory: false },
      ])
      buffer = Buffer.from(secret, 'utf8')
      await file.writeFile(buffer)
      await file.sync()
    } finally {
      await file.close()
      buffer?.fill(0)
      buffer = undefined
    }
  } catch (error) {
    failure =
      error instanceof RemoteTargetsFailure
        ? error
        : new RemoteTargetsFailure('delivery-failed', i18n.t('credential.delivery-failed'))
  } finally {
    buffer?.fill(0)
  }

  if (failure === undefined) {
    try {
      result = await consume(path)
    } catch (error) {
      failure = consumptionFailure(error)
    }
  }

  if (directory !== undefined) {
    try {
      await rm(directory, { recursive: true })
    } catch {
      if (failure !== undefined) throw failedCleanup(failure)
      throw new InvocationFailure('unknown-result', i18n.t('credential.cleanup-failed'), {
        details: { executionCompleted: true, cleanupFailed: true },
      })
    }
  }
  if (failure !== undefined) throw failure
  return result as T
}

/** 迁移读取只接受有界 UTF-8 普通文件；不跟随符号链接。 */
export async function readCredentialFile(path: string): Promise<string> {
  let buffer: Buffer | undefined
  try {
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink())
      throw new RemoteTargetsFailure('io', i18n.t('credential.file-not-regular'))
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const current = await file.stat()
      if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino)
        throw new RemoteTargetsFailure('io', i18n.t('credential.file-changed'))
      if (current.size > MAX_CREDENTIAL_BYTES)
        throw new RemoteTargetsFailure('credential-too-large', i18n.t('credential.file-too-large'))
      buffer = Buffer.alloc(Math.min(current.size + 1, MAX_CREDENTIAL_BYTES + 1))
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
        if (bytesRead === 0) break
        length += bytesRead
      }
      if (length > MAX_CREDENTIAL_BYTES || length > current.size)
        throw new RemoteTargetsFailure('credential-too-large', i18n.t('credential.file-too-large'))
      if (length === 0) throw new RemoteTargetsFailure('invalid-spec', i18n.t('credential.file-empty'))
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length))
    } finally {
      await file.close()
    }
  } catch (error) {
    if (error instanceof RemoteTargetsFailure) throw error
    throw new RemoteTargetsFailure('io', i18n.t('credential.file-read-failed'))
  } finally {
    buffer?.fill(0)
  }
}

/** 在受限临时副本上不带口令导出公钥，成功才允许登记、更新或迁移。 */
export async function assertUnencryptedPrivateKey(secret: string): Promise<void> {
  await withCredentialFile(secret, async path => {
    const result = await createCommandRunner().run('ssh-keygen', ['-y', '-P', '', '-f', path], { timeoutMs: 10_000 })
    if (result.exitCode !== 0) {
      throw new RemoteTargetsFailure('encrypted-key-unsupported', i18n.t('credential.encrypted-key'))
    }
  })
}

/** 加固目录与文件；Windows 合并为一次 PowerShell 调用，避免每次交付承担两次解释器启动。 */
async function permissions(targets: readonly AclTarget[]): Promise<void> {
  for (const { path, directory } of targets) {
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
      throw new RemoteTargetsFailure('delivery-failed', i18n.t('credential.temp-not-regular'))
  }
  if (process.platform !== 'win32') {
    for (const { path, directory } of targets) {
      if (process.getuid !== undefined && (await lstat(path)).uid !== process.getuid())
        throw new RemoteTargetsFailure('delivery-failed', i18n.t('credential.temp-owner'))
      const mode = directory ? 0o700 : 0o600
      await chmod(path, mode)
      if (((await lstat(path)).mode & 0o777) !== mode)
        throw new RemoteTargetsFailure('delivery-failed', i18n.t('credential.temp-mode'))
    }
    return
  }
  const result = await execa(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ACL_SCRIPT, 'utf16le').toString('base64')],
    {
      input: JSON.stringify({ paths: targets.map(({ path, directory }) => ({ path, directory })) }),
      reject: false,
      timeout: 15000,
      maxBuffer: 65536,
      windowsHide: true,
    },
  )
  if (result.exitCode !== 0 || result.stdout !== 'verified')
    throw new RemoteTargetsFailure('delivery-failed', i18n.t('credential.temp-acl-failed'))
}

function consumptionFailure(error: unknown): Error {
  if (error instanceof DomainFailure || error instanceof InvocationFailure || error instanceof SecurityFailure)
    return error
  return new RemoteTargetsFailure('io', i18n.t('credential.execution-failed'))
}

/** 双重失败不携带原消息、路径或异常对象，但保留调用方可判定的原分类。 */
function failedCleanup(failure: Error): Error {
  const message = i18n.t('credential.double-failure')
  const details = {
    executionCompleted:
      (failure instanceof InvocationFailure || failure instanceof RemoteTargetsFailure) &&
      failure.details?.executionCompleted === true,
    cleanupFailed: true,
  }
  if (failure instanceof InvocationFailure)
    return new InvocationFailure(failure.code, message, { details, cause: failure })
  if (failure instanceof RemoteTargetsFailure) return new RemoteTargetsFailure(failure.code, message, details)
  if (failure instanceof SecurityFailure) {
    const safe = new SecurityFailure(
      failure.code,
      failure.reason === undefined ? undefined : { reason: failure.reason },
    )
    safe.message = message
    return safe
  }
  if (failure instanceof DomainFailure) return new DomainFailure(failure.code, message)
  return new RemoteTargetsFailure('delivery-failed', message, details)
}
