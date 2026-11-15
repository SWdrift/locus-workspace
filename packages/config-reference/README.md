# 配置引用

`@locus/config-reference` 只解析、校验与脱敏配置中的稳定引用：

```ts
import { parseCredentialRef, resolveCredentialRef } from '@locus/config-reference'

const ref = parseCredentialRef('credential:postgres-local')
const fromConfig = resolveCredentialRef({ credential: ref })
```

它不读取 Keyring、不读取文件、不访问 Provider、不执行迁移。`credential:` 后只接受小写字母、数字与短横线；失败统一为 `ConfigReferenceFailure`。职责边界见[配置引用子系统](../../docs/subsystems/config-reference.md)。
