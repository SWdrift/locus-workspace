import { constants } from 'node:fs'
import { execa } from 'execa'
import { chmod, lstat, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import { RemoteTargetsFailure } from './types.ts'
import { createCommandRunner } from './runner.ts'

const MAX_CREDENTIAL_BYTES = 1024 * 1024
const ACL_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$j=[Console]::In.ReadToEnd() | ConvertFrom-Json
try {
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($j.directory) { $acl=New-Object Security.AccessControl.DirectorySecurity } else { $acl=New-Object Security.AccessControl.FileSecurity }
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true,$false)
  $allowed=@($sid.Value,'S-1-5-18','S-1-5-32-544')
  foreach($value in $allowed) {
    $identity=New-Object Security.Principal.SecurityIdentifier($value)
    if($j.directory) { $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow') }
    else { $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow') }
    $acl.AddAccessRule($rule)
  }
  if($j.directory) { [IO.Directory]::SetAccessControl($j.path,$acl); $actual=[IO.Directory]::GetAccessControl($j.path) }
  else { [IO.File]::SetAccessControl($j.path,$acl); $actual=[IO.File]::GetAccessControl($j.path) }
  if(!$actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'acl' }
  $seen=@{}
  foreach($rule in $actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    $value=$rule.IdentityReference.Value
    if($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or $allowed -notcontains $value -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'acl' }
    $seen[$value]=$true
  }
  foreach($value in $allowed) { if(!$seen[$value]) { throw 'acl' } }
  [Console]::Out.Write('verified')
} catch { exit 1 }
`

async function permissions(path: string, directory: boolean): Promise<void> {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new RemoteTargetsFailure('delivery-failed', '临时凭据路径不是普通文件')
  if (process.platform !== 'win32') {
    if (process.getuid !== undefined && stat.uid !== process.getuid()) throw new RemoteTargetsFailure('delivery-failed', '临时凭据归属不符')
    await chmod(path, directory ? 0o700 : 0o600)
    if (((await lstat(path)).mode & 0o777) !== (directory ? 0o700 : 0o600)) throw new RemoteTargetsFailure('delivery-failed', '临时凭据权限不符')
    return
  }
  const result = await execa('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ACL_SCRIPT, 'utf16le').toString('base64')], {
    input: JSON.stringify({ path, directory }),
    reject: false,
    timeout: 15000,
    maxBuffer: 65536,
    windowsHide: true,
  })
  if (result.exitCode !== 0 || result.stdout !== 'verified') throw new RemoteTargetsFailure('delivery-failed', '无法建立受限临时凭据权限')
}

/** 在独占临时目录内写入凭据，回调返回后删除；不保留崩溃恢复租约。 */
export async function withCredentialFile<T>(secret: string, consume: (path: string) => Promise<T>): Promise<T> {
  let directory: string | undefined
  let buffer: Buffer | undefined
  try {
    directory = await mkdtemp(join(tmpdir(), 'locus-remote-'))
    await permissions(directory, true)
    const path = join(directory, 'credential')
    const file = await open(path, 'wx', 0o600)
    try {
      await permissions(path, false)
      buffer = Buffer.from(secret, 'utf8')
      await file.writeFile(buffer)
      await file.sync()
    } finally {
      await file.close()
      buffer?.fill(0)
      buffer = undefined
    }
    return await consume(path)
  } catch (error) {
    if (error instanceof RemoteTargetsFailure) throw error
    throw new RemoteTargetsFailure('delivery-failed', '凭据交付失败')
  } finally {
    buffer?.fill(0)
    if (directory !== undefined) {
      try { await rm(directory, { recursive: true }) } catch { throw new RemoteTargetsFailure('io', '临时凭据清理失败') }
    }
  }
}

/** 迁移读取只接受有界 UTF-8 普通文件；不跟随符号链接。 */
export async function readCredentialFile(path: string): Promise<string> {
  let buffer: Buffer | undefined
  try {
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink()) throw new RemoteTargetsFailure('io', '凭据文件必须是普通文件')
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const current = await file.stat()
      if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino) throw new RemoteTargetsFailure('io', '凭据文件在读取期间变化')
      if (current.size > MAX_CREDENTIAL_BYTES) throw new RemoteTargetsFailure('credential-too-large', '凭据文件超过 1 MiB')
      buffer = Buffer.alloc(Math.min(current.size + 1, MAX_CREDENTIAL_BYTES + 1))
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
        if (bytesRead === 0) break
        length += bytesRead
      }
      if (length > MAX_CREDENTIAL_BYTES || length > current.size) throw new RemoteTargetsFailure('credential-too-large', '凭据文件超过 1 MiB')
      if (length === 0) throw new RemoteTargetsFailure('invalid-spec', '凭据文件为空')
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length))
    } finally {
      await file.close()
    }
  } catch (error) {
    if (error instanceof RemoteTargetsFailure) throw error
    throw new RemoteTargetsFailure('io', '无法读取凭据文件')
  } finally {
    buffer?.fill(0)
  }
}

/** 仅用于迁移预检：在受限临时副本上不带口令导出公钥，成功才允许切换。 */
export async function assertUnencryptedPrivateKey(secret: string): Promise<void> {
  await withCredentialFile(secret, async (path) => {
    const result = await createCommandRunner().run('ssh-keygen', ['-y', '-P', '', '-f', path], { timeoutMs: 10_000 })
    if (result.exitCode !== 0) {
      throw new RemoteTargetsFailure('encrypted-key-unsupported', '私钥带口令或无法解析；不会自动去除口令，需先确定口令交付方案')
    }
  })
}
