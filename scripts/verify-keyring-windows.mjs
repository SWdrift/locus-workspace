import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 这是显式手工平台检查，不属于 pnpm test。临时账户密码只经过内存与受控 stdin。
if (process.platform !== 'win32' || process.argv.length !== 3 || process.argv[2] !== '--isolated-account' || process.env.NODE_TEST_CONTEXT !== undefined || process.env.NODE_ENV === 'test') {
  console.error('用法：管理员在测试上下文之外运行 node scripts/verify-keyring-windows.mjs --isolated-account')
  process.exit(2)
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const elevated = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'], { encoding: 'utf8', windowsHide: true })
if (elevated.status !== 0 || elevated.stdout.trim() !== 'True') {
  console.error('独立 OS 账户验证需要管理员权限；不会改用当前用户 Keyring。')
  process.exit(2)
}
const root = mkdtempSync(join(process.env.ProgramData, 'locus-keyring-verification-'))
const name = `locus-k-${randomBytes(4).toString('hex')}`
const password = `${randomBytes(32).toString('base64url')}aA1!`
const keyringRequire = createRequire(join(repo, 'packages/core/package.json'))
const nativeEntry = keyringRequire.resolve('@napi-rs/keyring')
const nativeRequire = createRequire(nativeEntry)
const platformBinary = nativeRequire.resolve('@napi-rs/keyring-win32-x64-msvc')
const script = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$j = [Console]::In.ReadToEnd() | ConvertFrom-Json
$created = $false
$sid = $null
$code = 1
$accountCleaned = $false
$profileCleaned = $false
$stage = 'module'
try {
  Import-Module Microsoft.PowerShell.LocalAccounts -ErrorAction Stop
  $stage = 'password-input'
  $secret = New-Object System.Security.SecureString
  foreach ($character in $j.password.ToCharArray()) { $secret.AppendChar($character) }
  $secret.MakeReadOnly()
  $stage = 'account-create'
  $u = New-LocalUser -Name $j.name -Password $secret -AccountNeverExpires -UserMayNotChangePassword -Description 'Locus isolated Keyring verification (temporary)'
  $created = $true
  $sid = $u.SID.Value
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $current = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.SetOwner($current)
  foreach ($s in @($current.Value, 'S-1-5-18', $sid)) {
    $identity = New-Object System.Security.Principal.SecurityIdentifier($s)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  [IO.Directory]::SetAccessControl($j.root, $acl)
  $credential = New-Object System.Management.Automation.PSCredential(($env:COMPUTERNAME + '\' + $j.name), $secret)
  $arguments = @(('"' + $j.checker + '"'), $sid, $j.service)
  $p = Start-Process -FilePath $j.node -ArgumentList $arguments -WorkingDirectory $j.root -Credential $credential -LoadUserProfile -RedirectStandardOutput $j.stdout -RedirectStandardError $j.stderr -PassThru -Wait
  $code = $p.ExitCode
  [Console]::Out.Write([IO.File]::ReadAllText($j.stdout))
  if ($code -ne 0) { [Console]::Error.WriteLine('Isolated native validation failed; no backend error payload is printed.') }
} catch {
  [Console]::Error.WriteLine('Isolated account/launch failed; current-account Keyring was not used.')
  [Console]::Out.WriteLine((@{stage=$stage; category=$_.CategoryInfo.Category.ToString(); errorId=$_.FullyQualifiedErrorId} | ConvertTo-Json -Compress))
  $code = 1
} finally {
  if ($created -and $sid) {
    try {
      $profile = Get-CimInstance Win32_UserProfile -Filter ("SID='" + $sid + "'")
      if ($profile) { $profile | Remove-CimInstance }
      $profileCleaned = $true
    } catch { $code = 1 }
    try {
      $owned = Get-LocalUser -Name $j.name
      if ($owned.SID.Value -ne $sid) { throw 'account ownership changed' }
      $owned | Remove-LocalUser
      $accountCleaned = $true
    } catch { $code = 1 }
  }
  [Console]::Out.WriteLine((@{accountCreated=$created; accountCleaned=$accountCleaned; profileCleaned=$profileCleaned} | ConvertTo-Json -Compress))
}
exit $code
`
try {
  mkdirSync(join(root, 'test'))
  mkdirSync(join(root, 'lib', 'security'), { recursive: true })
  mkdirSync(join(root, 'node_modules', '@napi-rs'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  cpSync(process.execPath, join(root, 'node.exe'))
  cpSync(join(repo, 'packages/core/test/manual-keyring.mjs'), join(root, 'test', 'manual-keyring.mjs'))
  for (const file of ['keyring-provider.js', 'errors.js']) cpSync(join(repo, 'packages/core/lib/security', file), join(root, 'lib/security', file))
  cpSync(dirname(nativeEntry), join(root, 'node_modules/@napi-rs/keyring'), { recursive: true })
  cpSync(dirname(platformBinary), join(root, 'node_modules/@napi-rs/keyring-win32-x64-msvc'), { recursive: true })
  const input = JSON.stringify({ name, password, root, node: join(root, 'node.exe'), checker: join(root, 'test/manual-keyring.mjs'), stdout: join(root, 'stdout.json'), stderr: join(root, 'stderr.txt'), service: `locus:${randomUUID()}:development` })
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { input, encoding: 'utf8', windowsHide: true, timeout: 120000 })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  process.exitCode = result.status ?? 1
  if (result.error) console.error('隔离检查启动或期限失败；请按本次随机账户名核对清理：' + name)
} finally {
  rmSync(root, { recursive: true, force: true })
}
