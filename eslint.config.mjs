import tsParser from '@typescript-eslint/parser'

const outsidePackage = {
  regex: '^(?:\\.\\./)+(?:packages|apps)/|^(?:\\.\\./)+[^/]+/(?:src|lib)/|^@locus/[^/]+/(?:src|lib)(?:/|$)',
  message: '跨包只能使用 package exports，不能访问其他包的源码或构建内部路径。',
}
const coreRuntime = {
  name: '@locus/core',
  allowImportNames: ['createLocusCore', 'CreateLocusCoreOptions', 'LocusCore', 'LocusInfo', 'LOCUS_VERSION'],
  message: 'Core 根入口只负责运行时创建；从所属公开分面导入其他符号。',
}

export default [
  {
    files: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
    languageOptions: { parser: tsParser },
    rules: {
      'no-restricted-imports': ['error', { paths: [coreRuntime], patterns: [outsidePackage] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration',
          message: '公开入口必须显式导出；内部模块直接依赖实现文件。',
        },
      ],
    },
  },
  {
    files: ['packages/*/src/**/*.ts'],
    ignores: ['packages/core/src/**/*.ts'],
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
              regex: '^@locus/core/(?!invocation$|components$|security$|workspaces$|events$|storage$)',
              message: '只使用 Core 声明的公开子路径。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            outsidePackage,
            { group: ['@locus/*', 'commander'], message: 'Core 不依赖自身公开入口、客户端或业务消费者。' },
            { regex: '(?:^|/)index(?:\\.ts)?$', message: 'Core 内部依赖具体实现文件，不经公开 barrel。' },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportAllDeclaration', message: '公开入口必须显式导出；内部模块直接依赖实现文件。' },
        {
          selector: 'ImportExpression[source.value=/^@locus/]',
          message: 'Core 不动态加载客户端或业务消费者。',
        },
        {
          selector: 'CallExpression[callee.name="require"][arguments.0.value=/^@locus/]',
          message: 'Core 不加载客户端或业务消费者。',
        },
      ],
    },
  },
]
