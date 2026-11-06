# 开发与验证

搭建教程引导新贡献者从准备前置条件开始，直到检出目录通过检查。后面的贡献者参考介绍仓库布局、日常工作流和 CI 组织方式。设计依据与实现细节属于链接的 Agent Note 和脚本。

## 搭建教程

### 前置条件

- Node.js 24 或更高
- pnpm 11.24.0

### 安装与构建

检出后执行 `pnpm install`。首次运行和每次修改源码后执行 `pnpm build`：它通过 `tsc -b tsconfig.json` 按项目引用把 `packages/*` 与 `plugins/*` 编译到各自 `lib/`，配置文件见[根 tsconfig](../tsconfig.json)。

## 宿主运行

Locus 当前以 DSH profile 插件运行。profile 数据固定在仓库内 `.dsh/` 并由 Git 忽略；首次使用时把两个插件包链接进 `locus` profile：

```sh
DSH_HOME=.dsh pnpm exec dsh plugin --profile locus add \
  link:"$PWD/packages/host-dsh" link:"$PWD/plugins/cli"
```

随后在 `.dsh/profiles/locus/cordis.patch.yml` 写入两行插入项：

```yaml
- insert:
    - id: locus-host
      name: '@locus/host-dsh'
    - id: locus-cli
      name: '@locus/cli'
```

运行 `DSH_HOME=.dsh pnpm exec dsh --profile locus version`，应输出 `0.0.0` 并以 0 退出。不要调用 PATH 上的全局 `dsh`；插件加载、profile 与补丁语义见[DSH 插件开发](references/dsh-plugin-development.md)。

## 修改与验证

修改 `scripts/docs.mjs` 后先运行 `pnpm docs:test`，验证检查器对通过和失败输入的判定；再运行 `pnpm docs:check`，确认仓库当前 Markdown 全部通过。命令与成功判据见[实用命令](commands.md)，脚本对应关系见[维护脚本](../scripts/README.md)。

## 宿主插件开发

DSH/Cordis 插件的最小结构、生命周期、配置、本地调试、打包与安装方式，以及官方文档入口见[DSH 插件开发](references/dsh-plugin-development.md)。
