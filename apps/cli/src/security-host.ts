import { emitKeypressEvents } from 'node:readline'
import type { Key } from 'node:readline'
import type { ReadStream, WriteStream } from 'node:tty'
import { SecurityFailure } from '@locus/core'
import type { CapabilityAuthority, CapabilityContext, ClearCapabilityLevelInput, ComponentSpec, CredentialBinding, CredentialCleanupResult, CredentialMetadata, CredentialRef, CredentialStatus, HostSecurity, SecurityHost, SecurityParameters, SecurityResource, SetCapabilityLevelInput } from '@locus/core'

/** 仅可信 CLI 组合根注入；普通组件不持有输入端口。 */
export interface CliSecurityUI {
  readonly interactive: boolean
  readSecret(prompt: string): Promise<string>
  confirmLocalTakeover(warning: string): Promise<boolean>
}

const RESET_WARNING = '警告：重置 Root 相当于本机管理接管，无需旧密码。此操作将替换 Root 验证材料、清除锁定并撤销旧授权；不会删除 Workspace，也不会删除或恢复资源凭据。同一 OS 用户仍可绕过本地软件边界。'

/** 隐藏输入不经过 readline 的行回显，也不经过 argv、环境变量或普通 stdin spec。 */
export function createTerminalSecurityUI(input: ReadStream = process.stdin, output: WriteStream = process.stderr): CliSecurityUI {
  let reading = false
  const interactive = (): boolean => input.isTTY === true && output.isTTY === true && typeof input.setRawMode === 'function'

  function readSecret(prompt: string): Promise<string> {
    if (!interactive() || reading) return Promise.reject(new SecurityFailure('authentication-unavailable'))
    reading = true
    return new Promise<string>((resolve, reject) => {
      const wasRaw = input.isRaw
      const wasFlowing = input.readableFlowing
      let secret = ''
      let finished = false

      function restore(): boolean {
        input.removeListener('keypress', onKeypress)
        input.removeListener('error', onUnavailable)
        input.removeListener('end', onCancel)
        input.removeListener('close', onCancel)
        process.removeListener('SIGINT', onCancel)
        process.removeListener('SIGTERM', onCancel)
        process.removeListener('SIGHUP', onCancel)
        process.removeListener('exit', onExit)
        reading = false
        try {
          input.setRawMode(wasRaw)
          if (wasFlowing !== true) input.pause()
          return true
        } catch {
          return false
        }
      }

      function finish(error?: SecurityFailure): void {
        if (finished) return
        finished = true
        const restored = restore()
        try {
          output.write('\n')
        } catch {
          error = new SecurityFailure('authentication-unavailable')
        }
        if (!restored) error = new SecurityFailure('authentication-unavailable')
        if (error === undefined) resolve(secret)
        else reject(error)
        secret = ''
      }

      function onCancel(): void { finish(new SecurityFailure('authentication-cancelled')) }
      function onUnavailable(): void { finish(new SecurityFailure('authentication-unavailable')) }
      function onExit(): void { secret = ''; restore() }
      function onKeypress(text: string | undefined, key: Key): void {
        if ((key.ctrl && (key.name === 'c' || key.name === 'd' || key.name === 'z')) || key.name === 'escape') {
          onCancel()
        } else if (key.name === 'return' || key.name === 'enter') {
          finish()
        } else if (key.name === 'backspace') {
          const last = secret.codePointAt(secret.length - 1)
          const width = last !== undefined && last >= 0xdc00 && last <= 0xdfff && secret.length > 1 ? 2 : 1
          secret = secret.slice(0, -width)
        } else if (key.ctrl && key.name === 'u') {
          secret = ''
        } else if (!key.ctrl && !key.meta && text !== undefined && !/[\u0000-\u001f\u007f\u001b]/.test(text)) {
          secret += text
        }
      }

      try {
        emitKeypressEvents(input)
        input.on('keypress', onKeypress)
        input.once('error', onUnavailable)
        input.once('end', onCancel)
        input.once('close', onCancel)
        process.once('SIGINT', onCancel)
        process.once('SIGTERM', onCancel)
        process.once('SIGHUP', onCancel)
        process.once('exit', onExit)
        input.setRawMode(true)
        output.write(prompt)
        input.resume()
      } catch {
        onUnavailable()
      }
    })
  }

  return {
    get interactive() { return interactive() },
    readSecret,
    async confirmLocalTakeover(warning) {
      if (!interactive()) throw new SecurityFailure('authentication-unavailable')
      output.write(`${warning}\n`)
      return await readSecret('输入 RESET ROOT 确认本机管理接管（输入隐藏）：') === 'RESET ROOT'
    },
  }
}

function credentialReference(reference: string): CredentialRef {
  if (!/^credential:[a-z][a-z0-9-]*$/.test(reference)) throw new SecurityFailure('access-denied', { reason: 'invalid-request' })
  return reference as CredentialRef
}

/** Host 只来自 receiveHost 闭包；返回的命令编排不提供读取原始秘密的入口。 */
export function createCliSecurityHost(
  host: SecurityHost,
  ui: CliSecurityUI = createTerminalSecurityUI(),
) {
  function requireInteractive(): void {
    if (!ui.interactive) throw new SecurityFailure('authentication-unavailable')
  }

  async function newRootPassword(operation: (password: string, confirmation: string) => Promise<void>): Promise<void> {
    requireInteractive()
    let password = ''
    let confirmation = ''
    try {
      password = await ui.readSecret('新 Root 密码：')
      confirmation = await ui.readSecret('再次输入新 Root 密码：')
      await operation(password, confirmation)
    } finally {
      password = ''
      confirmation = ''
    }
  }

  async function rootOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (!(error instanceof SecurityFailure) || error.code !== 'authentication-required' || error.challenge === undefined) throw error
      const challenge = error.challenge
      let password = ''
      let authenticated = false
      try {
        requireInteractive()
        password = await ui.readSecret('Root 密码：')
        const grant = await host.authenticate(challenge, password)
        password = ''
        authenticated = true
        // 只消费 Core 保存的原闭包，绝不再次提交可替换的动作或参数。
        return await host.resume<T>(grant)
      } catch (failure) {
        if (!authenticated) {
          try { host.cancelChallenge(challenge) } catch (cancelFailure) {
            if (!(cancelFailure instanceof SecurityFailure)) throw new SecurityFailure('authentication-unavailable')
          }
        }
        throw failure
      } finally {
        password = ''
      }
    }
  }

  async function inSession<T>(operation: (port: HostSecurity) => Promise<T>): Promise<T> {
    const session = host.createSession('human')
    try {
      return await operation(host.forSession(session))
    } finally {
      host.endSession(session)
    }
  }

  async function executeComponent<T>(
    definition: ComponentSpec,
    capability: string,
    resource: SecurityResource,
    parameters: SecurityParameters,
    handler: (context: CapabilityContext) => Promise<T>,
  ): Promise<T> {
    const session = host.createSession('human')
    try {
      const port = host.bindComponent(session, definition)
      return await rootOperation(() => port.execute({ capability, resource, parameters }, (context) => handler(context)))
    } finally {
      host.endSession(session)
    }
  }

  return {
    async initializeRoot(): Promise<void> {
      await newRootPassword((password, confirmation) => host.initializeRoot(password, confirmation))
    },
    async resetRoot(): Promise<void> {
      requireInteractive()
      if (!await ui.confirmLocalTakeover(RESET_WARNING)) throw new SecurityFailure('authentication-cancelled')
      await newRootPassword((password, confirmation) => host.resetRoot(password, confirmation))
    },
    async changeRootPassword(): Promise<void> {
      await newRootPassword((password, confirmation) => inSession((port) => rootOperation(() => port.changeRootPassword(password, confirmation))))
    },
    async listCredentials(): Promise<readonly CredentialMetadata[]> {
      return inSession((port) => port.listCredentials())
    },
    async removeCredential(reference: string): Promise<void> {
      const ref = credentialReference(reference)
      requireInteractive()
      await inSession((port) => rootOperation(() => port.deleteCredential(ref)))
    },
    async listBindings(): Promise<readonly CredentialBinding[]> {
      return inSession((port) => port.listBindings())
    },
    async unbindCredential(componentId: string, capability: string, resource: SecurityResource, slot: string): Promise<boolean> {
      requireInteractive()
      return inSession((port) => rootOperation(() => port.unbindCredential({ componentId, capability, resource, slot })))
    },
    async credentialStatus(reference: string): Promise<CredentialStatus> {
      const ref = credentialReference(reference)
      requireInteractive()
      return inSession((port) => rootOperation(() => port.credentialStatus(ref)))
    },
    async cleanupCredentialOrphans(apply: boolean): Promise<CredentialCleanupResult> {
      requireInteractive()
      return inSession((port) => rootOperation(() => port.cleanupCredentialOrphans(apply)))
    },
    async setCapabilityLevel(input: SetCapabilityLevelInput): Promise<CapabilityAuthority> {
      requireInteractive()
      return inSession((port) => rootOperation(() => port.setCapabilityLevel(input)))
    },
    async clearCapabilityLevel(input: ClearCapabilityLevelInput): Promise<CapabilityAuthority> {
      requireInteractive()
      return inSession((port) => rootOperation(() => port.clearCapabilityLevel(input)))
    },
    async listCapabilityAuthorities(): Promise<readonly CapabilityAuthority[]> {
      return inSession((port) => port.listCapabilityAuthorities())
    },
    async readSecret(prompt: string): Promise<string> {
      requireInteractive()
      return ui.readSecret(prompt)
    },
    executeComponent,
  }
}
