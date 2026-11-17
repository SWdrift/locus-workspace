import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { execa } from 'execa'

export interface ComponentCommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  /** 子进程未能启动时的系统错误码，如 `ENOENT`。 */
  readonly errorCode: string | null
  readonly timedOut: boolean
}

/** 组件探针与部署命令的执行边界；测试注入假实现。 */
export interface ComponentRunner {
  run(argv: readonly string[], options: { timeoutMs: number }): Promise<ComponentCommandResult>
}

const MAX_BUFFER = 1024 * 1024

function isFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    if (process.platform !== 'win32') accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function candidates(base: string): string[] {
  if (process.platform !== 'win32') return [base]
  const extensions = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter((extension) => extension.length > 0)
    .map((extension) => (extension.startsWith('.') ? extension : `.${extension}`))
  return [base, ...extensions.map((extension) => `${base}${extension}`)]
}

/** 解析 PATH/PATHEXT；显式路径只检查给定文件及其 Windows 扩展名。 */
function commandExists(command: string): boolean {
  if (command.includes('/') || command.includes('\\') || isAbsolute(command)) {
    return candidates(command).some(isFile)
  }
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter((directory) => directory.length > 0)
    .some((directory) => candidates(join(directory, command)).some(isFile))
}

/**
 * Windows 工具的输出编码不统一：多数写 UTF-8，部分系统工具（如 WSL）写无 BOM 的
 * UTF-16LE。UTF-16LE 的 ASCII 片段会在奇数位出现 NUL；没有 NUL 的纯中文 UTF-16
 * 无法与 UTF-8 可靠区分，仍按 UTF-8 处理。
 */
function decodeOutput(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le')
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 128))
  let zeros = 0
  for (const byte of sample) {
    if (byte === 0) zeros += 1
  }
  if (sample.length >= 8 && zeros >= 4) {
    return buffer.toString('utf16le')
  }
  return buffer.toString('utf8')
}

/** 生产执行器：不经过 shell；execa 负责 Windows 的 .cmd/.bat 解析与参数转义。 */
export function createComponentRunner(): ComponentRunner {
  return {
    async run(argv, options) {
      const [command, ...args] = argv
      if (command === undefined) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: '组件命令为空',
          errorCode: 'EINVAL',
          timedOut: false,
        }
      }
      // execa 在 Windows 会把未找到的命令交给 cmd.exe，丢失 ENOENT；先自行解析。
      if (!commandExists(command)) {
        return { exitCode: 1, stdout: '', stderr: '', errorCode: 'ENOENT', timedOut: false }
      }
      try {
        const result = await execa(command, [...args], {
          reject: false,
          timeout: options.timeoutMs,
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
          stdin: 'ignore',
          stripFinalNewline: false,
          encoding: 'buffer',
        })
        return {
          exitCode: result.exitCode ?? (result.timedOut ? 124 : 1),
          stdout: decodeOutput(Buffer.from(result.stdout ?? new Uint8Array())),
          stderr: decodeOutput(Buffer.from(result.stderr ?? new Uint8Array())),
          errorCode: null,
          timedOut: result.timedOut,
        }
      } catch (error) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          errorCode: 'EIO',
          timedOut: false,
        }
      }
    },
  }
}
