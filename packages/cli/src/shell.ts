import { createInterface } from 'node:readline'
import type { ParsedCommand } from './commands.ts'

export interface ShellIO {
  readonly stdin: NodeJS.ReadableStream & { isTTY?: boolean }
  readonly stdout: NodeJS.WritableStream & { isTTY?: boolean }
  readonly stderr: NodeJS.WritableStream
}

export interface ShellCommands {
  readonly commands: ParsedCommand
  /** 当前命令树绑定的服务是否仍属于同一个运行实例。 */
  readonly current: () => boolean
}

/**
 * 按 shell 习惯拆分一行命令，支持单引号、双引号和反斜杠转义。
 * Windows 路径中的反斜杠只有出现在空白、引号或反斜杠前才作为转义。
 */
export function splitCommandLine(line: string): string[] {
  const args: string[] = []
  let token = ''
  let quote: '"' | "'" | undefined
  let started = false
  const push = (): void => {
    if (!started) return
    args.push(token)
    token = ''
    started = false
  }
  for (let index = 0; index < line.length; index++) {
    const character = line[index]
    if (character === undefined) break
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined
        continue
      }
      if (quote === '"' && character === '\\' && (line[index + 1] === '"' || line[index + 1] === '\\')) {
        token += line[index + 1] ?? ''
        index++
        continue
      }
      token += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (/\s/u.test(character)) {
      push()
      continue
    }
    if (character === '\\' && (line[index + 1] === '"' || line[index + 1] === "'" || line[index + 1] === '\\' || /\s/u.test(line[index + 1] ?? ''))) {
      token += line[index + 1] ?? ''
      index++
      started = true
      continue
    }
    token += character
    started = true
  }
  if (quote !== undefined) throw new Error('引号未闭合。')
  push()
  return args
}

function isCommanderError(error: unknown): error is { code: string; exitCode: number } {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { code?: unknown; exitCode?: unknown }
  return typeof candidate.code === 'string'
    && candidate.code.startsWith('commander.')
    && typeof candidate.exitCode === 'number'
}

function wireOutput(program: ParsedCommand['program'], io: ShellIO): void {
  program.exitOverride().configureOutput({
    writeOut: (text) => void io.stdout.write(text),
    writeErr: (text) => void io.stderr.write(text),
  })
  for (const child of program.commands) wireOutput(child, io)
}

/**
 * 在当前 DSH 进程中连续执行命令。每行重新建立命令树，领域服务仍取自当前 Context；
 * 单条失败或 Commander 错误只记录并继续。插件被卸载时关闭输入且不请求进程退出，
 * 以便 HMR 重新加载 CLI 后由新实例接管。
 */
export async function runShell(
  create: () => ShellCommands,
  exit: (code: number) => void,
  registerDispose: (dispose: () => void) => void,
  io: ShellIO = process,
): Promise<void> {
  const terminal = Boolean(io.stdin.isTTY && io.stdout.isTTY)
  const lines = createInterface({
    input: io.stdin,
    output: io.stdout,
    terminal,
    historySize: 100,
    prompt: 'locus> ',
  })
  let disposed = false
  let lastExit = 0
  const prompt = (): void => {
    if (terminal && !disposed) lines.prompt()
  }
  registerDispose(() => {
    disposed = true
    lines.close()
  })
  if (terminal) io.stdout.write('Locus shell：输入 help 查看命令，exit 退出。\n')
  prompt()
  try {
    for await (const raw of lines) {
      if (disposed) break
      const line = raw.trim()
      if (line === '') {
        prompt()
        continue
      }
      if (line === 'exit' || line === 'quit') break
      let args: string[]
      try {
        args = splitCommandLine(line)
      } catch (error) {
        io.stderr.write(`Locus shell 解析失败：${error instanceof Error ? error.message : String(error)}\n`)
        lastExit = 1
        prompt()
        continue
      }
      let created: ShellCommands
      try {
        created = create()
      } catch (error) {
        if (disposed) break
        io.stderr.write(`Locus shell 创建命令失败：${error instanceof Error ? error.message : String(error)}\n`)
        lastExit = 2
        prompt()
        continue
      }
      const { commands, current } = created
      wireOutput(commands.program, io)
      try {
        commands.parse(args)
      } catch (error) {
        if (isCommanderError(error)) lastExit = error.exitCode
        else {
          io.stderr.write(`Locus shell 解析失败：${error instanceof Error ? error.message : String(error)}\n`)
          lastExit = 1
        }
        prompt()
        continue
      }
      if (commands.shell()) {
        io.stderr.write('已经在 shell 中。\n')
        lastExit = 1
        prompt()
        continue
      }
      const pending = commands.execute()
      if (!pending) {
        io.stderr.write('未选择命令。\n')
        lastExit = 1
        prompt()
        continue
      }
      try {
        const result = await pending
        if (disposed) break
        if (!current()) {
          io.stderr.write('Locus 操作期间能力已重载，结果未确认。\n')
          lastExit = 2
          prompt()
          continue
        }
        io.stdout.write(commands.json() ? `${JSON.stringify(result.value)}\n` : `${result.text}\n`)
        lastExit = result.exitCode ?? 0
      } catch (error) {
        if (disposed) break
        io.stderr.write(`Locus 操作失败：${error instanceof Error ? error.message : String(error)}\n`)
        lastExit = 2
      }
      prompt()
    }
  } finally {
    if (!disposed) {
      lines.close()
      exit(lastExit)
    }
  }
}
