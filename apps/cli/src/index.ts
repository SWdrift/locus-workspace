#!/usr/bin/env node
import { runCli } from './composition.ts'

process.exitCode = await runCli(process.argv.slice(2))
