import tsParser from '@typescript-eslint/parser'

const outsidePackage = {
  // 从包内 src 到仓库级 components 至少跨三层，避免误判 Core 内部的同名领域目录。
  regex:
    '^(?:\\.\\./)+(?:packages|apps)/|^(?:\\.\\./){3,}components/|^(?:\\.\\./)+[^/]+/(?:src|lib)/|^@locus/[^/]+/(?:src|lib)(?:/|$)',
  message: '跨包只能使用 package exports，不能访问其他包的源码或构建内部路径。',
}
const coreRuntime = {
  name: '@locus/core',
  allowImportNames: ['createLocusCore', 'CreateLocusCoreOptions', 'LocusCore', 'LocusInfo', 'LOCUS_VERSION'],
  message: 'Core 根入口只负责运行时创建；从所属公开分面导入其他符号。',
}
const exportAll = {
  selector: 'ExportAllDeclaration',
  message: '公开入口必须显式导出；内部模块直接依赖实现文件。',
}
const textLiterals = [
  {
    selector: 'Literal[value=/[\\u4e00-\\u9fff]/]',
    message: '面向用户的文案必须放在本包 i18n 表中。',
  },
  {
    selector: 'TemplateElement[value.raw=/[\\u4e00-\\u9fff]/]',
    message: '面向用户的文案必须放在本包 i18n 表中。',
  },
]
const coreSyntax = [
  exportAll,
  {
    selector: 'ImportExpression[source.value=/^@locus/]',
    message: 'Core 不动态加载客户端或业务消费者。',
  },
  {
    selector: 'CallExpression[callee.name="require"][arguments.0.value=/^@locus/]',
    message: 'Core 不加载客户端或业务消费者。',
  },
]
const coreImports = {
  patterns: [
    outsidePackage,
    { group: ['@locus/*', 'commander'], message: 'Core 不依赖自身公开入口、客户端或业务消费者。' },
    { regex: '(?:^|/)index(?:\\.ts)?$', message: 'Core 内部依赖具体实现文件，不经公开 barrel。' },
  ],
}
// 每包自己的 i18n 表是唯一允许出现中文文案字面量的位置。
const i18nFiles = ['apps/*/src/i18n.ts', 'packages/*/src/i18n.ts', 'components/*/src/i18n.ts']
const coreI18nFiles = ['packages/core/src/i18n/**/*.ts']

export default [
  {
    files: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts', 'components/*/src/**/*.ts'],
    ignores: ['**/src/i18n.ts', 'packages/core/src/i18n/**'],
    languageOptions: { parser: tsParser },
    rules: {
      'no-restricted-imports': ['error', { paths: [coreRuntime], patterns: [outsidePackage] }],
      'no-restricted-syntax': ['error', exportAll, ...textLiterals],
    },
  },
  {
    files: i18nFiles,
    languageOptions: { parser: tsParser },
    rules: {
      'no-restricted-imports': ['error', { paths: [coreRuntime], patterns: [outsidePackage] }],
      'no-restricted-syntax': ['error', exportAll],
    },
  },
  {
    files: coreI18nFiles,
    languageOptions: { parser: tsParser },
    rules: {
      'no-restricted-imports': ['error', coreImports],
      'no-restricted-syntax': ['error', ...coreSyntax],
    },
  },
  {
    files: ['components/*/src/**/*.ts'],
    ignores: ['**/src/i18n.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [coreRuntime, { name: 'commander', message: '组件包不能承担 CLI 参数、提示或退出码。' }],
          patterns: [
            outsidePackage,
            {
              regex: '^@locus/(?!core(?:/|$))',
              message: '能力包独立消费 Core，不依赖 CLI 或其他能力包。',
            },
            {
              regex: '^@locus/core/(?!invocation$|components$|security$|workspaces$|events$|storage$|i18n$)',
              message: '只使用 Core 声明的公开子路径。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/i18n/**'],
    rules: {
      'no-restricted-imports': ['error', coreImports],
      'no-restricted-syntax': ['error', ...coreSyntax, ...textLiterals],
    },
  },
]
