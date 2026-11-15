# 配置引用

## 职责

`@locus/config-reference` 只处理配置文件中的稳定引用：

- 解析并校验 `credential:<id>`。
- 从普通配置对象读取 `credential` 字段。
- 校验相对数据目录的安全配置路径。
- 不读取 Keyring、不读取文件、不访问 Provider、不执行迁移。

它不拥有凭据、不决定权限，也不保存“当前实例”。组件负责读取自己的配置文件并解释字段语义；Core 负责绑定、字段拆分与交付。

## 契约

```ts
type CredentialRef = `credential:${string}`

parseCredentialRef(value: unknown): CredentialRef
isCredentialRef(value: unknown): value is CredentialRef
resolveCredentialRef(config: unknown, field = 'credential'): CredentialRef
assertConfigPath(value: unknown): string
```

- `credential:` 后必须以小写字母开头，只含小写字母、数字和短横线。
- 拒绝路径、空白、通配、其它协议与大写名称。
- 配置路径必须是安全的相对路径；`..`、绝对路径、Windows 盘符与 NUL 拒绝。
- 失败统一为 `ConfigReferenceFailure`，code 为 `invalid-reference`。

## 使用边界

PostgreSQL、Gitea 与 Remote Targets 在配置边界调用 `parseCredentialRef`；CLI 仍自行校验命令行引用。组件不得各自复制引用正则，也不得把引用当秘密或 Keyring 账户名。完整凭据模型见 [Core Security](core-security.md)，命令入口见[命令手册](../commands.md#安全与凭据)。
