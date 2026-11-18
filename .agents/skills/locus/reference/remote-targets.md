# 远程目标参考

所有访问经 rt://；不直接调用 ssh/plink，也不自行读取秘密内容。配置仅保存认证方式，Core 按 component + slot + target id 绑定凭据。

## 发现与读取

```sh
locus help rt://
locus --json get rt://targets
locus --json get rt://targets/<target>
```

目标接受 id、唯一前缀或唯一标签；歧义需改用完整 id。

## 登记与凭据

PUT rt://targets/<id> 的 JSON Body 包含 spec 字符串（其内容为目标 YAML 或 JSON）；将 Body 保存为 registration.json 后调用：

```sh
locus put rt://targets/<id> --file registration.json --field-file privateKey=/absolute/key.pem
locus post rt://targets/<id>/actions/credential --data '{"method":"private-key"}' --field-file privateKey=/absolute/key.pem
locus post rt://targets/<id>/actions/credential --data '{"method":"password"}' --prompt password
```

可选秘密字段必须明确选择，不能把密码或私钥值塞进 JSON Body。全部私钥写入路径在包内预检，带口令或非法私钥明确失败。Root 输入由可信 Host 处理，不接受环境密码。

显式迁移先 GET rt://targets/<id>/actions/migration-source 查询旧路径，再通过可信字段文件调用 POST rt://targets/<id>/actions/migrate，Body 为 method。原文件保留，不自动去除口令。

## 访问与失败

```sh
locus get rt://targets/<target>/system
locus get rt://targets/<target>/services
locus post rt://targets/<target>/jobs --data '{"command":["whoami"]}'
locus post rt://targets/<target>/jobs --data '{"interactive":true}'
locus post rt://targets/<target>/services/<service>/actions/restart
locus delete rt://targets/<target>
```

普通 JSON 在 data，探测需检查 data.ok，命令需检查 data.exitCode；通用 CLI 不透传远端进程退出码。services/restart 只服务 cmd 目标。unknown-result 且 executionCompleted 表示执行已完成但清理失败，需人工核对而非自动重试。删除目标清理观察，不撤销 Core 绑定或删除信任锚。

字段与失败分类见 [Remote Targets](../../../../packages/remote-targets/README.md)。
