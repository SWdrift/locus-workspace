# Locus Skill 脚本

脚本只读取 CLI 的 JSON 输出，不直接访问 SQLite，也不写入 Workspace。需要 Node.js 24+。

`LOCUS_CLI` 指向 `apps/cli/lib/index.js`；在 `locus shell` 内已自动注入。仓库内未设置时会回退到构建后的本地 CLI，因此先执行 `pnpm build`。

| 脚本 | 用途 |
| --- | --- |
| `workspace-pick.mjs [name-or-id]` | 无参数时列出 `id<TAB>name<TAB>挂载数`；有参数时输出匹配的 Identity，名称歧义失败 |
| `workspace-summary.mjs <workspace>` | 读取 Workspace，输出挂载（缺失标记）与长期关系 |
| `shell-context.mjs <workspace> [--json]` | 调用 `locus shell <workspace> --print-env`，输出 POSIX `export` 或完整 JSON |

示例：

```sh
WS=$(node .agents/skills/locus/scripts/workspace-pick.mjs 研究)
node .agents/skills/locus/scripts/workspace-summary.mjs "$WS"
eval "$(node .agents/skills/locus/scripts/shell-context.mjs "$WS")"
```

退出码：0 成功；1 找不到 Workspace、名称歧义、CLI 失败或输出不是 JSON。诊断只写 stderr。
