# 组件参考

组件描述能力与观察，不授予调用方权限。包组件来自代码，动态组件只接受 external 定义；帮助读取声明不等于探测或部署。

```sh
locus routes locus://components
locus --json get locus://components
locus --json get locus://components/docker
locus post locus://components --data '{"path":"/absolute/component.yaml"}'
locus post locus://components/docker/actions/probe
locus post locus://components/actions/probe
locus post locus://components/my-service/actions/deploy
locus post locus://components/remote-targets/actions/upgrade
locus delete locus://components/docker
```

probe 的状态在 data.external，probe-all 的 probed/skipped 在 data；调用成功并不表示所有探针 healthy。deploy 的业务状态同理必须检查。只在用户明确要求时执行部署，不自动安装或启动软件。

没有 component 命令树或 locus <id> 快捷入口。Core 自有 locus 不能登记，包组件不可删除；删除动态组件只删除定义和观察，不卸载外部软件。YAML 和数据库边界见[组件子系统](../../../../docs/subsystems/core/components.md)。
