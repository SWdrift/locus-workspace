import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SCRIPT = fileURLToPath(new URL('./docs.mjs', import.meta.url));

function put(root, name, text) {
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

function emptyRoot(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'locus-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function fixture(t) {
  const root = emptyRoot(t);
  put(root, 'README.md', '# 测试入口\n');
  put(root, 'docs/guide.md', '# 中文指南\n\n## 中文标题\n');
  return root;
}

function invoke(root, extra = []) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, ...extra], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 15_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function passes(result) {
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.equal(result.stderr, '');
}

function fails(result, expected) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, expected);
}

function snapshot(root) {
  const result = {};
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file, name);
      else result[name] = { content: readFileSync(file).toString('base64'), modified: statSync(file, { bigint: true }).mtimeNs };
    }
  }
  visit(root);
  return result;
}

function note(state) {
  const sections = {
    proposed: ['问题', '提案', '备选方案', '验收标准', '风险'],
    implemented: ['问题', '决定', '备选方案', '后果'],
    rejected: ['问题', '提案', '备选方案', '验收标准', '风险'],
  };
  const status = state === 'rejected' ? 'rejected — 不满足实际约束' : state;
  return `# 决策记录：测试记录\n\nStatus: ${status}\n\n${sections[state].map((title) => `## ${title}\n\n说明。\n`).join('\n')}`;
}

test('校验中文、重复与冲突锚点、目录、图片和简单 inline 链接，保持源文件不变', (t) => {
  const root = fixture(t);
  put(root, 'docs/guide.md', '# 中文指南\n\n## 中文标题\n\n## 中文标题\n\n## 中文标题-1\n\n[返回](../README.md#测试入口)\n');
  put(root, 'docs/路径 示例（中文）.md', '# 编码文档\n\n## 本地标题\n');
  put(root, 'docs/pixel.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const encoded = encodeURIComponent('路径 示例（中文）.md');
  put(root, 'README.md', [
    '# 测试入口', '',
    '[中文](docs/guide.md#中文标题)',
    '[重复](docs/guide.md#中文标题-1)',
    '[冲突](docs/guide.md#中文标题-1-1)',
    `[编码](docs/${encoded}#${encodeURIComponent('本地标题')})`,
    '[带 title](<docs/guide.md> "中文说明")',
    '![图片](docs/pixel.svg#不检查非Markdown锚点)',
    '[目录](docs/#目录锚点不检查)',
    '[查询串](docs/guide.md?view=raw#中文标题)',
    '[外链](https://example.invalid/never-request)',
    '[角括号外链](<https://example.invalid/a(b)> \'标题\')',
    '普通 [id]、[提示] 和未闭合的 [ 方括号不应被当作链接。',
    '- [ ] 未完成', '- [x] 已完成', '',
  ].join('\n'));
  const before = snapshot(root);
  passes(invoke(root));
  assert.deepEqual(snapshot(root), before);
});

test('缺失链接、图片、锚点与无效百分号编码返回错误且不改文件', async (t) => {
  const cases = [
    ['Markdown 目标', '[不存在](docs/absent.md)', /\[LINK\] README\.md:3/],
    ['图片目标', '![不存在](docs/absent.png)', /\[LINK\] README\.md:3/],
    ['标题锚点', '[不存在](docs/guide.md#不存在)', /\[ANCHOR\] README\.md:3/],
    ['错误编码', '[编码](docs/%ZZ.md)', /\[LINK\] README\.md:3/],
  ];
  for (const [name, text, expected] of cases) {
    await t.test(name, (t) => {
      const root = fixture(t);
      put(root, 'README.md', `# 测试入口\n\n${text}\n`);
      const before = snapshot(root);
      fails(invoke(root), expected);
      assert.deepEqual(snapshot(root), before);
    });
  }
});

test('围栏和单/多反引号 inline-code 内的链接示例不参与检查', (t) => {
  const root = fixture(t);
  put(root, 'README.md', [
    '# 代码示例', '',
    '````markdown', '[无效](missing.md)', '<a href="missing.md">忽略</a>',
    '```', '[仍在四反引号围栏内](also-missing.md)', '````', '',
    '~~~', '![无图](missing.png)', '[引用][id]', '~~~', '',
    '`[不存在](missing.md)` 与 ``含 ` 和 [引用][id]``。', '',
    '`跨行 [示例](missing.md)', '[标签][id]`', '',
  ].join('\n'));
  passes(invoke(root));
});

test('结构检查报告未闭合围栏、缺失一级标题与非法 UTF-8', async (t) => {
  const cases = [
    ['围栏未闭合', '# 入口\n\n~~~js\n[忽略](missing.md)\n', /\[MARKDOWN\] README\.md:3/],
    ['缺失一级标题', '## 只有二级标题\n', /\[MARKDOWN\] README\.md/],
    ['非法 UTF-8', Buffer.from([0xff, 0xfe, 0xfd]), /\[UTF8\] README\.md/],
  ];
  for (const [name, text, expected] of cases) {
    await t.test(name, (t) => {
      const root = fixture(t);
      put(root, 'README.md', text);
      fails(invoke(root), expected);
    });
  }
});

test('显式 reference-link、HTML-link 及超出受限 inline 方言的写法明确失败', async (t) => {
  const cases = [
    ['完整引用', '[说明][guide]'], ['折叠引用', '[guide][]'],
    ['引用定义', '[guide]: docs/guide.md'],
    ['HTML 链接', '<a href="docs/guide.md">指南</a>'],
    ['HTML 图片', '<img src="docs/pixel.svg">'],
    ['自动链接', '<https://example.invalid/>'],
    ['嵌套裸括号', '[说明](docs/a(b).md)'],
    ['跨行 inline', '[说明\n文字](docs/guide.md)'],
  ];
  for (const [name, text] of cases) {
    await t.test(name, (t) => {
      const root = fixture(t);
      put(root, 'README.md', `# 方言边界\n\n${text}\n`);
      fails(invoke(root), /\[DIALECT\] README\.md:3/);
    });
  }
});

test('本地链接拒绝越界、编码越界、绝对路径与反斜杠', async (t) => {
  for (const target of ['../outside.md', '%2e%2e/outside.md', '/absolute.md', 'C:/absolute.md', 'file:///absolute.md', 'docs\\guide.md']) {
    await t.test(target, (t) => {
      const root = fixture(t);
      put(root, 'README.md', `# 路径边界\n\n[目标](<${target}>)\n`);
      fails(invoke(root), /\[PATH\] README\.md:3/);
    });
  }
});

test('既有维护目录内的新模块文档自动受检，无需登记', async (t) => {
  for (const name of ['packages/example/README.md', 'plugins/example/README.md', 'scripts/README.md']) {
    await t.test(name, (t) => {
      const root = fixture(t);
      put(root, name, '# 模块\n\n[失效引用](missing.md)\n');
      fails(invoke(root), /\[LINK\]/);
    });
  }
});

test('不递归依赖、临时目录、Git 元数据和项目 skills', (t) => {
  const root = fixture(t);
  for (const directory of ['temp', 'docs/temp', 'docs/node_modules', 'docs/.git', '.agents/skills']) {
    put(root, `${directory}/invalid.md`, '没有一级标题\n\n[不存在](missing.md)\n```\n');
  }
  passes(invoke(root));
});

test('拒绝扫描域符号链接，检查不会向链接目标写入', (t) => {
  const root = fixture(t);
  mkdirSync(path.join(root, 'assets'));
  try {
    symlinkSync(path.join(root, 'assets'), path.join(root, 'docs/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
    t.skip('当前运行账户不允许创建符号链接。');
    return;
  }
  fails(invoke(root), /\[PATH\]/);
  assert.deepEqual(readdirSync(path.join(root, 'assets')), []);
});

test('检查活动记录状态和章节，允许独有技术章节', (t) => {
  const root = fixture(t);
  put(root, '.agents/notes/AGENTS.md', '# 决策记录入口\n');
  for (const state of ['proposed', 'implemented', 'rejected']) {
    put(root, `.agents/notes/${state}/process/2026-11-06-${state}.md`, note(state));
  }
  put(root, 'docs/templates/decision-record.md', '# 记录模板\n\nStatus: proposed\n');
  passes(invoke(root));
  const file = '.agents/notes/implemented/process/2026-11-06-implemented.md';
  put(root, file, note('implemented').replace('## 备选方案', '## 包拓扑\n\n模块间的依赖关系。\n\n## 备选方案'));
  passes(invoke(root));
  put(root, file, note('implemented').replace('Status: implemented', 'Status: proposed'));
  fails(invoke(root), /\[NOTE\]/);
  put(root, file, note('implemented').replace('## 后果', '## 其他'));
  fails(invoke(root), /\[NOTE\]/);
  for (const title of ['提案', '计划', '迁移计划', '验收标准']) {
    put(root, file, `${note('implemented')}\n## ${title}\n\n不应保留。\n`);
    fails(invoke(root), /\[NOTE\]/);
  }
});

test('固定头部与问题首节不能被宽松匹配绕过', async (t) => {
  const cases = [
    ['标题标记', (text) => text.replace('# 决策记录：', '# 记录：')],
    ['英文标题标记', (text) => text.replace('# 决策记录：', '# Agent Note:')],
    ['标题后缺空行', (text) => text.replace('\n\nStatus:', '\nStatus:')],
    ['状态后缺空行', (text) => text.replace('Status: implemented\n\n', 'Status: implemented\n')],
    ['首节不是问题', (text) => text.replace('## 问题', '## 背景\n\n背景。\n\n## 问题')],
    ['英文必需章节', (text) => text.replace('## 决定', '## Decision')],
  ];
  for (const [name, change] of cases) {
    await t.test(name, (t) => {
      const root = fixture(t);
      put(root, '.agents/notes/implemented/process/2026-11-06-format.md', change(note('implemented')));
      fails(invoke(root), /\[NOTE\]/);
    });
  }
});

test('拒绝记录必须在状态行给出理由，并保留提案期章节', (t) => {
  const root = fixture(t);
  const file = '.agents/notes/rejected/feature/2026-11-06-rejected.md';
  const proposal = `${note('rejected')}\n## 计划\n\n保留原提案计划。\n`;
  put(root, file, proposal);
  const before = snapshot(root);
  passes(invoke(root));
  assert.deepEqual(snapshot(root), before);
  put(root, file, proposal.replace('Status: rejected — 不满足实际约束', 'Status: rejected'));
  fails(invoke(root), /\[NOTE\]/);
  put(root, file, proposal.replace('Status: rejected — 不满足实际约束', 'Status: rejected — '));
  fails(invoke(root), /\[NOTE\]/);
});

test('强制生命周期与类别目录封闭，禁止集中索引和散落记录', async (t) => {
  const cases = [
    ['未知生命周期', { '.agents/notes/draft/feature/2026-11-06-misplaced.md': note('proposed') }, /未知生命周期目录/],
    ['未知类别', { '.agents/notes/proposed/refactor/2026-11-06-misplaced.md': note('proposed') }, /未知类别目录/],
    ['集中索引', { '.agents/notes/INDEX.md': '# 记录索引\n' }, /禁止集中式 INDEX\.md/],
    ['生命周期根散落记录', { '.agents/notes/proposed/2026-11-06-misplaced.md': note('proposed') }, /生命周期根只允许 AGENTS\.md/],
    ['类别下嵌套目录', { '.agents/notes/proposed/feature/nested/2026-11-06-misplaced.md': note('proposed') }, /类别目录下不再建立子目录/],
  ];
  for (const [name, files, expected] of cases) {
    await t.test(name, (t) => {
      const root = fixture(t);
      for (const [file, text] of Object.entries(files)) put(root, file, text);
      fails(invoke(root), expected);
    });
  }
  const root = fixture(t);
  for (const state of ['proposed', 'implemented', 'rejected', 'archived']) {
    put(root, `.agents/notes/${state}/AGENTS.md`, `# ${state} 生命周期\n`);
  }
  put(root, '.agents/notes/implemented/process/2026-11-06-present.md', note('implemented'));
  passes(invoke(root));
});

test('归档只检查身份元数据，但活动页指向归档仍检查锚点', (t) => {
  const root = fixture(t);
  const archived = '.agents/notes/archived/architecture/2026-11-06-archive.md';
  put(root, archived, '# 决策记录：归档示例\n\nStatus: implemented\nArchived: 2026-11-06\n\n## 保留标题\n\n[冻结旧链接](missing.md)\n\n```未闭合但冻结\n');
  put(root, 'README.md', `# 入口\n\n[归档](${archived}#保留标题)\n`);
  const before = snapshot(root);
  passes(invoke(root));
  assert.deepEqual(snapshot(root), before);
  put(root, 'README.md', `# 入口\n\n[归档](${archived}#不存在)\n`);
  fails(invoke(root), /\[ANCHOR\] README\.md:3/);
  put(root, 'README.md', '# 入口\n');
  put(root, archived, '# 决策记录：归档示例\n\nStatus: implemented\nArchived: 2026-02-30\n');
  fails(invoke(root), /\[NOTE\]/);
  put(root, archived, '# 决策记录：归档示例\n\nStatus: implemented\n\nArchived: 2026-11-06\n');
  fails(invoke(root), /\[NOTE\]/);
});

test('空扫描域和无效参数失败且不写文件', (t) => {
  const root = emptyRoot(t);
  const before = snapshot(root);
  fails(invoke(root), /\[SCAN\]/);
  fails(invoke(root, ['--unknown']), /\[USAGE\]/);
  fails(invoke(root, ['unexpected']), /\[USAGE\]/);
  fails(invoke(root, ['--root', root]), /\[USAGE\]/);
  assert.deepEqual(snapshot(root), before);
});

test('默认根目录来自脚本位置而非当前工作目录', (t) => {
  const root = fixture(t);
  const script = path.join(root, 'scripts/docs.mjs');
  mkdirSync(path.dirname(script));
  copyFileSync(SCRIPT, script);
  const result = spawnSync(process.execPath, [script], { cwd: tmpdir(), encoding: 'utf8', timeout: 15_000 });
  assert.ifError(result.error);
  passes(result);
});
