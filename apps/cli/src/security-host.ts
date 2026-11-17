import { emitKeypressEvents } from 'node:readline'
import type { Key } from 'node:readline'
import type { ReadStream, WriteStream } from 'node:tty'
import { SecurityFailure } from '@locus/core'

/** 仅可信 CLI 组合根注入；普通组件不持有输入端口。 */
export interface CliSecurityUI {
  readonly interactive: boolean
  readSecret(prompt: string): Promise<string>
  confirmLocalTakeover(warning: string): Promise<boolean>
}

export const RESET_WARNING = '警告：重置 Root 相当于本机管理接管，无需旧密码。此操作将替换 Root 验证材料、清除锁定并撤销旧授权；不会删除 Workspace，也不会删除或恢复资源凭据。同一 OS 用户仍可绕过本地软件边界。'

/** 隐藏输入不经过 readline 的回显，也不经过 argv、环境变量或普通 stdin spec。 */
export function createTerminalSecurityUI(input: ReadStream = process.stdin, output: WriteStream = process.stderr): CliSecurityUI {
  let reading = false
  const interactive = (): boolean => input.isTTY === true && output.isTTY === true && typeof input.setRawMode === 'function'

  function readSecret(prompt: string): Promise<string> {
    if (!interactive() || reading) return Promise.reject(new SecurityFailure('authentication-unavailable'))
    reading = true
    const { promise, resolve, reject } = Promise.withResolvers<string>()
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
    return promise
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

/** 两次隐藏输入；secret 不进入 argv、环境变量或 JSON Body。 */
export async function readNewRootPassword(ui: CliSecurityUI): Promise<{ password: string; confirmation: string }> {
  if (!ui.interactive) throw new SecurityFailure('authentication-unavailable')
  let password = ''
  try {
    password = await ui.readSecret('新 Root 密码：')
    const confirmation = await ui.readSecret('再次输入新 Root 密码：')
    return { password, confirmation }
  } finally {
    password = ''
  }
}
