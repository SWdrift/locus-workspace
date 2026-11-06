# 开发与验证

搭建教程引导新贡献者从准备前置条件开始，直到检出目录通过检查。后面的贡献者参考介绍仓库布局、日常工作流和 CI 组织方式。设计依据与实现细节属于链接的 Agent Note 和脚本。

## 搭建教程

### 前置条件

- Node.js 24 或更高
- pnpm 11.24.0

## 修改与验证

修改 `scripts/docs.mjs` 后先运行 `pnpm docs:test`，验证检查器对通过和失败输入的判定；再运行 `pnpm docs:check`，确认仓库当前 Markdown 全部通过。命令与成功判据见[实用命令](commands.md)，脚本对应关系见[维护脚本](../scripts/README.md)。
