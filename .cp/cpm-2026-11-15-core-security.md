# Core Security 继续工作入口

- 恢复实现先读[当前契约](../docs/subsystems/core/security.md)、[模块 API](../packages/core/README.md#安全服务)及[剩余提案](../.agents/notes/proposed/architecture/2026-11-15-core-security.md)，不要从旧 CP 草案重新推导身份／Policy。
- [已实施记录](../.agents/notes/implemented/architecture/2026-11-15-core-security-runtime.md)拥有取舍理由；本文件不维护第二套 KDF、Grant、Credential 或平台矩阵。
- PostgreSQL、Gitea、SSH 是各自普通包；不要再建独立 Delivery 平台，也不要把业务协议搬进 Core。
- remote-targets 新目标只接受 CredentialRef；旧 `auth.path/root` 只供显式 migrate。带口令私钥保持 `encrypted-key-unsupported`，不要用自动去口令或 argv/env 口令绕过。
- 实跑入口：`node packages/postgres/test/manual-postgres.mjs`、`node components/remote-targets/test/manual-ssh.mjs`；自动测试隔离归[测试系统](../docs/testing.md#安全与平台验证)。没有适合环境时保留未验证，不用 Production Keyring 补证据。
