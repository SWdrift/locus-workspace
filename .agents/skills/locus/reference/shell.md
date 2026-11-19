# 统一 Shell

`locus shell <workspace>` 启动用户当前平台的 shell，并在子进程环境中注入 Workspace 上下文与 `locus` 命令。它不是新解释器，也不接管用户 shell 的提示符、历史或配置。

## 启动

```sh
locus shell <workspace>
locus shell <workspace> --command "locus get locus://ws/<workspace>"
locus shell <workspace> --print-env
locus shell <workspace> --shell /path/to/shell
```

- `<workspace>` 接受 Identity 或唯一名称。
- `--shell` 覆盖默认 shell。Windows 默认 `powershell.exe`（或继承的 `SHELL`）；POSIX 默认 `$SHELL`，否则 `/bin/sh`。
- `--command` 执行一条命令后退出，退出码取自子 shell。
- `--print-env` 只输出解析后的 JSON 上下文，不启动 shell；用于调试与脚本。

## cwd 选择

1. 有 `primary` 挂载且目录可访问：使用它。
2. `primary` 不可访问：在 stderr 与 `--print-env` 报告 `primaryMissing`，回退到第一个可访问挂载。
3. 没有 `primary`：使用第一个可访问挂载。
4. 没有可访问挂载：使用用户主目录。

## 注入内容

| 变量 | 含义 |
| --- | --- |
| `LOCUS_CLI` | 当前 CLI 的 `index.js` 绝对路径 |
| `LOCUS_WORKSPACE_ID` | Workspace Identity |
| `LOCUS_WORKSPACE_NAME` | Workspace 名称 |
| `LOCUS_WORKSPACE_ROOT` | 选定的 cwd |
| `LOCUS_MOUNTS` | 所有挂载的 JSON 数组：`id`、`name`、`path`、`primary` |
| `LOCUS_MOUNT_<NAME>` | 每个挂载的路径；名称转为大写，非字母数字变为下划线，冲突时追加序号 |
| `PATH` | 前置临时 bin 目录，其中提供 `locus` 启动器 |

挂载缺失时，`--print-env` 的 `missing` 数组列出不可访问路径，交互启动会在 stderr 提示；可访问的挂载仍正常注入。

## 能力边界

- 注入的是进程环境与命令，不是系统权限、容器或文件系统沙箱。
- shell 内修改环境或 `cd` 只影响该子进程，不回写 Workspace。
- 临时 bin 与 `locus` 启动器只在该 shell 生命周期内存在，退出后清理。
- 不自动改写用户 `.bashrc`、PowerShell profile 或全局 PATH。
