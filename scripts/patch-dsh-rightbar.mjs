#!/usr/bin/env node
/**
 * 允许 Locus Main Panel 激活时保留 DSH 原生 rightbar。
 *
 * DSH 0.2.2-rc.1 的 ui-sidebar-right 把面板可见性/on-screen Session 绑定到
 * activePanelId === null。这里仅把判断扩展为 activePanelId === null || 'locus'。
 * 不修改 slot 注册、Conversation、layout 或 Session 存储。
 *
 * 用法：
 *   node scripts/patch-dsh-rightbar.mjs
 *   node scripts/patch-dsh-rightbar.mjs --revert
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PNPM = join(ROOT, 'node_modules', '.pnpm')
const BACKUP = '.locus-rightbar.bak'
const revert = process.argv.includes('--revert')

function packageDir(name) {
  for (const entry of readdirSync(PNPM)) {
    if (!entry.startsWith('@deepseek-ai+dsh-client-ui-')) continue
    const dir = join(PNPM, entry, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar-right')
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    if (pkg.version !== '0.2.2-rc.1') continue
    return dir
  }
  throw new Error('未找到 @deepseek-ai/dsh-client-ui-sidebar-right@0.2.2-rc.1')
}

const dir = packageDir('dsh-client-ui-sidebar-right')
const client = join(dir, 'lib', 'client.js')
const backup = client + BACKUP

if (revert) {
  if (!existsSync(backup)) throw new Error('没有可恢复的备份：' + backup)
  copyFileSync(backup, client)
  console.log('已恢复 DSH rightbar：' + client)
  process.exit(0)
}

let source = readFileSync(client, 'utf8')
if (source.includes('.locus-rightbar')) {
  console.log('DSH rightbar 已打过补丁：' + client)
  process.exit(0)
}
if (!existsSync(backup)) copyFileSync(client, backup)

const visible = 'const visible = usePanelInfo((info) => info.activePanelId === null);'
const visiblePatched = 'const visible = usePanelInfo((info) => info.activePanelId === null || info.activePanelId === "locus");'
const onScreen = 'const selected = views.source.getSnapshot().find((view) => view.selected);\n\t\t\t\t\tshow(layout.panelInfo.getSnapshot().activePanelId === null ? selected?.sessionId : void 0);'
const onScreenPatched = 'const selected = views.source.getSnapshot().find((view) => view.selected);\n\t\t\t\t\tconst locusPanel = layout.panelInfo.getSnapshot().activePanelId;\n\t\t\t\t\tshow(locusPanel === null || locusPanel === "locus" ? selected?.sessionId : void 0);'

if (!source.includes(visible) || !source.includes(onScreen)) {
  throw new Error('DSH rightbar 源码结构与补丁不匹配，拒绝修改')
}
source = source.replace(visible, visiblePatched).replace(onScreen, onScreenPatched + '\n\t\t\t\t\t/* .locus-rightbar */')
writeFileSync(client, source, 'utf8')
console.log('已给 DSH rightbar 打补丁：' + client)
console.log('重启 DSH 进程后生效；--revert 可恢复')
