import { defineI18n } from '@locus/core/i18n'

export const i18n = defineI18n('remote-targets', {
  'component.name': '远程目标',
  'component.summary': '登记并通过 SSH 访问远程目标',
  'component.info':
    '通过系统 OpenSSH/Plink 访问已登记目标。\n私钥与密码分别登记到独立字段槽；凭据按 component + slot + target id 绑定。\n密钥认证需要 openssh 组件为 healthy；密码认证需要 plink 组件。',

  // 配置
  'config.id-mismatch': 'spec.id 与命令参数不一致：{{actual}} != {{expected}}',
  'label.config': '配置',
  'config.version-required': '配置版本必须是 {{version}}',
  'config.targets-array': '配置的 targets 必须是数组',
  'config.target-id-duplicate': '目标 id 重复：{{id}}',
  'config.object-required': '{{path}} 必须是对象',
  'config.unknown-field': '{{path}} 含未知字段：{{key}}',
  'config.non-empty-string': '{{path}}.{{key}} 必须是非空字符串',
  'config.integer-required': '{{path}}.{{key}} 必须是整数',
  'config.id-invalid': '目标 id 只能包含小写字母、数字、点、下划线和连字符，且以字母或数字开头：{{id}}',
  'config.relative-path': '{{path}} 必须是相对路径：{{value}}',
  'config.path-traversal': '{{path}} 不能包含 ..：{{value}}',
  'config.parse-failed': '无法解析配置：{{detail}}',
  'config.auth-legacy-fields': '{{path}}.auth 使用新认证方式时不能提供旧 path/root',
  'config.auth-method': '{{path}}.auth.method 只能是 private-key、password 或旧 key：{{method}}',
  'config.auth-root-absolute': '{{path}}.auth.root 必须是绝对路径：{{root}}',
  'config.capabilities-array': '{{path}}.capabilities 必须是数组',
  'config.capability-invalid': '{{path}}.capabilities 含不支持的能力：{{capability}}',
  'config.protocol-unsupported': '暂不支持协议：{{transport}}',
  'config.via-invalid': '{{path}}.via 只能是 direct 或 frp：{{via}}',
  'config.port-range': '{{path}}.port 必须在 1-65535 之间：{{port}}',
  'config.remote-shell': '{{path}}.remoteShell 只能是 posix 或 cmd：{{shell}}',

  // 服务
  'service.root-absolute': 'remote-targets 根目录必须是绝对路径',
  'service.component-missing': '目标 {{target}} 需要组件 {{component}}，但它未登记',
  'service.component-state': '目标 {{target}} 需要组件 {{component}}，当前状态：{{state}}',
  'state.not-probed': '未探查',
  'service.capability-denied': '目标 {{target}} 未授权能力：{{capability}}',
  'service.cmd-only': '目标 {{target}} 的 remoteShell 是 {{shell}}；{{operation}} 仅支持 cmd',
  'service.legacy-auth': '目标 {{target}} 仍使用旧文件认证；需要显式迁移到 Core 凭据绑定',
  'service.slot-mismatch': '目标认证方式与凭据槽不匹配，需要 {{slot}} 槽',
  'service.config-changed': '目标 {{target}} 配置已变化；需要 Root 重新登记或确认',
  'service.credential-field-missing': '目标 {{target}} 缺少 {{slot}} 字段',
  'service.encrypted-key': '私钥带口令；不会自动去除口令，需先确定口令交付方案',
  'service.new-auth-method': '新目标必须使用 method: private-key 或 password；旧 path/root 仅用于迁移读取',
  'service.exists': '目标已存在：{{target}}',
  'service.already-bound': '目标 {{target}} 已使用 Core 凭据绑定',
  'service.legacy-file-missing': '目标 {{target}} 缺少可迁移的旧认证文件',
  'service.legacy-auth-unmigratable': '目标 {{target}} 的旧认证方式不可迁移',
  'service.exit-code': '退出码 {{code}}',
  'service.exec-empty': 'exec 需要至少一条远端命令',
  'service.service-name-invalid': '服务名不合法：{{name}}',
  'service.service-state-unparsable': '无法解析服务状态',
  'service.prefix-ambiguous': '目标前缀不唯一：{{reference}}；候选：{{candidates}}',
  'service.label-ambiguous': '目标标签不唯一：{{reference}}；候选：{{candidates}}',
  'service.not-found': '找不到目标：{{reference}}',
  'service.services-unparsable': '无法解析远端服务列表',

  // 凭据交付
  'credential.delivery-failed': '凭据交付失败',
  'credential.cleanup-failed': '远程操作已完成，但临时凭据清理失败；请勿自动重试',
  'credential.file-not-regular': '凭据文件必须是普通文件',
  'credential.file-changed': '凭据文件在读取期间发生变化',
  'credential.file-too-large': '凭据文件超过 1 MiB',
  'credential.file-empty': '凭据文件为空',
  'credential.file-read-failed': '无法读取凭据文件',
  'credential.encrypted-key': '私钥带口令或无法解析；不会自动去除口令，需先确定口令交付方案',
  'credential.temp-not-regular': '临时凭据路径不是普通文件',
  'credential.temp-owner': '临时凭据归属不符',
  'credential.temp-mode': '临时凭据权限不符',
  'credential.temp-acl-failed': '无法为临时凭据设置受限权限',
  'credential.execution-failed': '远程操作执行失败',
  'credential.double-failure': '操作失败，且临时凭据清理失败',

  // 凭据 operation
  'field.private-key':
    '按认证方式提供 privateKey/password 之一：认证方式为 private-key 时必须提供未加密 SSH 私钥文本；仅接受可信输入。',
  'field.password':
    '按认证方式提供 privateKey/password 之一：认证方式为 password 时必须提供 SSH 密码；仅接受可信输入。',
  'operation.credential.use-legacy': '目标 {{target}} 仍使用旧文件认证；需要显式迁移',
  'operation.credential.secret-missing': '缺少 {{slot}} 输入；秘密只能经可信 Host 收集',
  'operation.credential.method-mismatch': '目标认证方式与 method 不一致',
  'operation.credential.migrate-method': '迁移 method 必须与旧认证方式一致',
  'operation.credential.update':
    '更新路径 id 指定目标的绑定凭据（支持完整 ID、唯一 ID 前缀或唯一标签）；JSON Body 必填 method（private-key 或 password，必须与目标一致）；对应秘密由可信输入提供；无 query。返回 target、method 与 updated:true。',
  'operation.credential.migrate':
    '将路径 id 指定目标的旧文件认证迁移为 Core 凭据绑定（支持完整 ID、唯一 ID 前缀或唯一标签）；JSON Body 必填 method（旧 key 对应 private-key，旧 password 对应 password）；对应秘密由可信输入提供；无 query。返回迁移后的目标配置，不删除旧凭据文件。',

  // operation 摘要
  'operation.targets.list': '列出已登记的远程目标配置数组（不含秘密）；无路径参数、query 或 JSON Body。',
  'operation.target.get':
    '读取路径 id 指定的目标（支持完整 ID、唯一 ID 前缀或唯一标签），返回配置及可用的最近探测结果；无 query 或 JSON Body。',
  'operation.target.preview':
    '预检路径 id 指定的新目标；JSON Body 必填 spec（单个目标的 YAML/JSON 文本，含 resource、identity.login、identity.auth.method 和 connectivity.host），认证方式为 private-key 或 password；无 query。返回规范化配置，不保存目标或凭据。',
  'operation.target.migration-source':
    '读取路径 id 指定目标的旧凭据来源（支持完整 ID、唯一 ID 前缀或唯一标签），返回旧认证方式 method 与文件绝对路径 path，不读取秘密；无 query 或 JSON Body。',
  'operation.target.register':
    '登记路径 id 指定的新目标并绑定凭据；JSON Body 必填 spec（单个目标的 YAML/JSON 文本，含 resource、identity.login、identity.auth.method 和 connectivity.host），认证方式为 private-key 或 password；对应秘密由可信输入提供；无 query。返回保存后的规范化目标，已有 ID 不可覆盖。',
  'operation.target.remove':
    '删除路径 id 指定的目标配置与探测记录（支持完整 ID、唯一 ID 前缀或唯一标签），返回 target 与 removed:true；无 query 或 JSON Body。',
  'operation.job.run':
    '在路径 id 指定目标上运行 SSH 作业（支持完整 ID、唯一 ID 前缀或唯一标签）；JSON Body 的 command 为命令字符串数组，非交互作业必须非空；可选 interactive:true 改为交互 Shell 并忽略 command；无 query。非交互返回 targetId、exitCode、stdout、stderr，交互仅返回 exitCode。',
  'operation.services.list':
    '通过 SSH 读取路径 id 指定 Windows 目标的服务列表（支持完整 ID、唯一 ID 前缀或唯一标签，要求 cmd 远程 Shell）；无 query 或 JSON Body。返回 name/status 数组。',
  'operation.service.restart':
    '通过 SSH 重启路径 id 指定 Windows 目标上由路径参数 name 指定的服务（id 支持完整 ID、唯一 ID 前缀或唯一标签，要求 cmd 远程 Shell）；无 query 或 JSON Body。返回重启后的 name/status。',
  'operation.system.read':
    '通过 SSH 在路径 id 指定目标上执行 hostname 并保存探测记录（支持完整 ID、唯一 ID 前缀或唯一标签）；无 query 或 JSON Body。返回 targetId、ok、detail 与 checkedAt。',

  // 执行器与传输
  'runner.cancelled': '操作已取消',
  'runner.timeout': '命令超时',
  'runner.spawn-failed': '无法启动系统客户端',
  'ssh.path-outside-root': '路径超出目标根目录：{{relative}}',
  'ssh.password-fingerprint': 'password 认证必须提供 connectivity.trust.fingerprint（Plink 主机密钥）',
  'store.read-failed': '无法读取目标配置：{{detail}}',
  'store.write-failed': '无法写入目标配置：{{detail}}',
})
