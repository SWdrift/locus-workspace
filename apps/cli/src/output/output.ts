import type { Command } from 'commander'

export interface OutputFlags {
  readonly json?: boolean
  readonly human?: boolean
  readonly pretty?: boolean
}

export interface OutputOptions {
  readonly json: boolean
  readonly pretty: boolean
}

export interface OutputStreams {
  writeOut(text: string): void
  writeErr(text: string): void
}

export const processOutput: OutputStreams = {
  writeOut: text => {
    process.stdout.write(text)
  },
  writeErr: text => {
    process.stderr.write(text)
  },
}

export function addOutputOptions(command: Command): Command {
  return command
    .option('--json', '输出机器可读 JSON，诊断仍写入 stderr')
    .option('--pretty', '美化 JSON 输出；只影响 JSON')
    .option('--human', '强制人类可读输出')
}

/** 正常结果与异常共用优先级，--human 始终覆盖 --json。 */
export function resolveOutputOptions(flags: OutputFlags): OutputOptions {
  return { json: flags.json === true && flags.human !== true, pretty: flags.pretty === true }
}

export function outputOptions(command: Command): OutputOptions {
  return resolveOutputOptions(command.optsWithGlobals<OutputFlags>())
}

export function emit(command: Command, value: unknown, text: string): void {
  if (outputOptions(command).json) emitJson(command, value)
  else writeOut(command, `${text}\n`)
}

export function emitJson(command: Command, value: unknown): void {
  writeOut(command, jsonText(value, outputOptions(command).pretty))
}

export function jsonText(value: unknown, pretty: boolean): string {
  return `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`
}

export function writeOut(command: Command, text: string): void {
  root(command).configureOutput().writeOut!(text)
}

export function writeErr(command: Command, text: string): void {
  root(command).configureOutput().writeErr!(text)
}

function root(command: Command): Command {
  while (command.parent !== null) command = command.parent
  return command
}
