#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCAN_ROOTS = ['README.md', 'AGENTS.md', 'docs', '.agents/notes', 'packages', 'plugins', 'scripts'];
const IGNORED_NAMES = new Set(['.git', 'node_modules', 'temp']);
const NOTE_STATES = new Set(['proposed', 'implemented', 'rejected', 'archived']);
const NOTE_KINDS = new Set(['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing']);
const NOTE_SECTIONS = {
  proposed: ['问题', '提案', '备选方案', '验收标准', '风险'],
  implemented: ['问题', '决定', '备选方案', '后果'],
  rejected: ['问题', '提案', '备选方案'],
};
const DECODER = new TextDecoder('utf-8', { fatal: true });

class Failure extends Error {
  constructor(code, file, message, line) {
    super(message);
    this.issue = { code, file, message, line };
  }
}

function issue(code, file, message, line) {
  return { code, file, message, line };
}

function fail(code, file, message, line) {
  throw new Failure(code, file, message, line);
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/') || '.';
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function info(file, label) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    fail('IO', label, `无法读取文件信息：${error.message}`);
  }
}

function inside(root, name, label = name, base = root) {
  if (typeof name !== 'string' || !name || name.includes('\0') || name.includes('\\')) {
    fail('PATH', label, '路径必须是非空、使用 / 分隔的仓库相对路径；不接受反斜杠。');
  }
  if (path.posix.isAbsolute(name) || path.win32.isAbsolute(name) || /^[A-Za-z][A-Za-z\d+.-]*:/.test(name)) {
    fail('PATH', label, `禁止绝对路径或文件 URL：${name}`);
  }
  let current = base;
  for (const part of name.split('/')) {
    if (!part || part === '.') continue;
    current = path.resolve(current, part);
    const offset = path.relative(root, current);
    if (offset === '..' || offset.startsWith(`..${path.sep}`) || path.isAbsolute(offset)) {
      fail('PATH', label, `路径越出仓库根目录：${name}`);
    }
    if (info(current, label)?.isSymbolicLink()) {
      fail('PATH', label, `禁止符号链接：${relative(root, current)}`);
    }
  }
  return current;
}

function readText(file, label) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    fail('IO', label, `无法读取文件：${error.message}`);
  }
  try {
    return DECODER.decode(bytes);
  } catch (error) {
    fail('UTF8', label, `无法按 UTF-8 读取文件：${error.message}`);
  }
}

function ignored(name) {
  const parts = name.split('/');
  return parts.some((part) => IGNORED_NAMES.has(part)) || (parts[0] === '.agents' && parts[1] === 'skills');
}

function markdownFiles(root) {
  const found = new Set();
  function walk(file) {
    const name = relative(root, file);
    if (ignored(name)) return;
    const stat = info(file, name);
    if (!stat) fail('SCAN', name, '扫描入口或文件不存在。');
    if (stat.isSymbolicLink()) fail('PATH', name, '扫描域内禁止符号链接。');
    if (stat.isDirectory()) {
      let children;
      try {
        children = readdirSync(file).sort(compare);
      } catch (error) {
        fail('IO', name, `无法读取目录：${error.message}`);
      }
      for (const child of children) walk(path.join(file, child));
    } else if (stat.isFile() && path.extname(file).toLowerCase() === '.md') {
      found.add(file);
    }
  }
  for (const entry of SCAN_ROOTS) {
    const file = inside(root, entry);
    const name = relative(root, file);
    const stat = info(file, name);
    if (!stat) continue;
    if (!stat.isDirectory() && !(stat.isFile() && path.extname(file).toLowerCase() === '.md')) {
      fail('SCAN', name, '扫描入口必须是目录或 Markdown 文件。');
    }
    walk(file);
  }
  if (found.size === 0) fail('SCAN', '.', '扫描域内没有 Markdown 文件，不能进行空集合检查。');
  return [...found].sort((left, right) => compare(relative(root, left), relative(root, right)));
}

function escaped(text, index) {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) count++;
  return count % 2 === 1;
}

function maskInlineCode(text) {
  const masked = text.split('');
  for (let cursor = 0; cursor < text.length; cursor++) {
    if (text[cursor] !== '`' || escaped(text, cursor)) continue;
    let end = cursor + 1;
    while (text[end] === '`') end++;
    const width = end - cursor;
    let search = end;
    let closing = -1;
    while ((search = text.indexOf('`', search)) !== -1) {
      let after = search + 1;
      while (text[after] === '`') after++;
      if (after - search === width) {
        closing = after;
        break;
      }
      search = after;
    }
    if (closing !== -1) {
      for (let index = cursor; index < closing; index++) {
        if (text[index] !== '\n') masked[index] = ' ';
      }
      cursor = closing - 1;
    } else {
      cursor = end - 1;
    }
  }
  return masked.join('');
}

function lineAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor++) if (text[cursor] === '\n') line++;
  return line;
}

function destination(text, opening) {
  let cursor = opening + 1;
  while (/[ \t]/.test(text[cursor] ?? '\n')) cursor++;
  let target = '';
  if (text[cursor] === '<') {
    const start = ++cursor;
    while (cursor < text.length && text[cursor] !== '\n' && (text[cursor] !== '>' || escaped(text, cursor))) cursor++;
    if (text[cursor] !== '>') return undefined;
    target = text.slice(start, cursor++);
    if (target.includes('<')) return undefined;
  } else {
    const start = cursor;
    while (cursor < text.length && text[cursor] !== '\n') {
      if (!escaped(text, cursor) && /[\s()]/.test(text[cursor])) break;
      cursor++;
    }
    target = text.slice(start, cursor);
    if (text[cursor] === '(') return undefined;
  }
  const beforeSpace = cursor;
  while (/[ \t]/.test(text[cursor] ?? '\n')) cursor++;
  if (cursor > beforeSpace && (text[cursor] === '"' || text[cursor] === "'")) {
    const quote = text[cursor++];
    while (cursor < text.length && text[cursor] !== '\n' && (text[cursor] !== quote || escaped(text, cursor))) cursor++;
    if (text[cursor] !== quote) return undefined;
    cursor++;
    while (/[ \t]/.test(text[cursor] ?? '\n')) cursor++;
  }
  if (text[cursor] !== ')') return undefined;
  return { target: target.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1'), end: cursor + 1 };
}

function inlineLinks(text, file) {
  const links = [];
  const errors = [];
  for (let cursor = 0; cursor < text.length; cursor++) {
    if (text[cursor] !== '[' || escaped(text, cursor)) continue;
    const start = cursor > 0 && text[cursor - 1] === '!' && !escaped(text, cursor - 1) ? cursor - 1 : cursor;
    let end = cursor + 1;
    let nested = false;
    let depth = 1;
    while (end < text.length) {
      if (text[end] === '[' && !escaped(text, end)) {
        depth++;
        nested = true;
      }
      if (text[end] === ']' && !escaped(text, end) && --depth === 0) break;
      end++;
    }
    const line = lineAt(text, cursor);
    if (text[end] !== ']') continue;
    const label = text.slice(cursor + 1, end);
    const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
    let after = end + 1;
    while (/[ \t]/.test(text[after] ?? '\n')) after++;
    if (text[after] === '\n') {
      after++;
      while (/[ \t]/.test(text[after] ?? '\n')) after++;
    }
    const definition = text[end + 1] === ':' && /^ {0,3}$/.test(text.slice(lineStart, cursor));
    if (definition || text[after] === '[') {
      const referenceEnd = text[after] === '[' ? text.indexOf(']', after + 1) : -1;
      if (definition || (referenceEnd !== -1 && !text.slice(after + 1, referenceEnd).includes('\n'))) {
        errors.push(issue('DIALECT', file, '不支持 reference-link（含定义与折叠形式）；请改用单行 [文字](目标)。', line));
        cursor = referenceEnd === -1 ? end : referenceEnd;
        continue;
      }
    }
    if (text[end + 1] !== '(') continue;
    if (label.includes('\n')) {
      errors.push(issue('DIALECT', file, '不支持跨行链接标签；请使用单行 [文字](目标)。', line));
      cursor = end;
      continue;
    }
    if (nested) {
      errors.push(issue('DIALECT', file, '不支持嵌套链接标签；请使用单行简单 [文字](目标)。', line));
      cursor = end;
      continue;
    }
    const parsed = destination(text, end + 1);
    if (!parsed) {
      errors.push(issue('DIALECT', file, '链接语法不受支持或未闭合：仅支持单行简单 inline 链接，可用 <目标> 及引号 title，不支持嵌套裸括号。', line));
      cursor = end;
      continue;
    }
    links.push({ start, end: parsed.end, destinationStart: end + 1, label, target: parsed.target, line });
    cursor = parsed.end - 1;
  }
  const html = /<\s*\/?\s*(?:a|img|link)(?=[\s/>])|<(?:[A-Za-z][A-Za-z\d+.-]*:|[^<>\s]+@[^<>\s]+\.)[^>\n]*>/gi;
  for (const match of text.matchAll(html)) {
    if (escaped(text, match.index) || links.some((link) => match.index >= link.destinationStart && match.index < link.end)) continue;
    errors.push(issue('DIALECT', file, '不支持 HTML 链接、HTML 图片或自动链接；请使用 [文字](目标) / ![替代](目标)。', lineAt(text, match.index)));
  }
  return { links, errors };
}

function headingSlug(title) {
  const parsed = inlineLinks(title, '');
  for (const link of parsed.links.toReversed()) {
    title = title.slice(0, link.start) + link.label + title.slice(link.end);
  }
  return title.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:\d+|x[\da-f]+);/gi, (entity) => {
    const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
    if (Object.hasOwn(named, entity.toLowerCase())) return named[entity.toLowerCase()];
    const value = entity.slice(2, -1);
    const point = value[0].toLowerCase() === 'x' ? Number.parseInt(value.slice(1), 16) : Number(value);
    return point <= 0x10ffff ? String.fromCodePoint(point) : '';
  }).trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
}

function parseMarkdown(text, file) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const headings = [];
  const prose = [];
  const errors = [];
  let opening;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening) {
      if (fence && fence[1][0] === opening.marker[0] && fence[1].length >= opening.marker.length && !fence[2].trim()) opening = undefined;
      prose.push(' '.repeat(line.length));
      continue;
    }
    if (fence) {
      opening = { marker: fence[1], line: index + 1 };
      prose.push(' '.repeat(line.length));
      continue;
    }
    prose.push(line);
    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(line);
    if (heading) {
      const title = (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
      if (!title) errors.push(issue('MARKDOWN', file, 'ATX 标题不能为空。', index + 1));
      headings.push({ level: heading[1].length, title, line: index + 1 });
    } else if (/^ {0,3}#{7,}(?:\s|$)/.test(line)) {
      errors.push(issue('MARKDOWN', file, 'ATX 标题只支持 1 至 6 级。', index + 1));
    }
  }
  if (opening) errors.push(issue('MARKDOWN', file, '代码围栏未闭合。', opening.line));
  if (!headings.some((heading) => heading.level === 1)) errors.push(issue('MARKDOWN', file, '文档至少需要一个 ATX 一级标题（# 标题）。'));
  const anchors = new Set();
  for (const heading of headings) {
    const base = headingSlug(heading.title);
    let slug = base;
    let suffix = 0;
    while (anchors.has(slug)) slug = `${base}-${++suffix}`;
    anchors.add(slug);
  }
  return { headings, anchors, prose: maskInlineCode(prose.join('\n')), errors };
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function noteState(file) {
  if (!file.startsWith('.agents/notes/') || file === '.agents/notes/AGENTS.md') return undefined;
  const parts = file.split('/');
  if (parts.length !== 5 || !NOTE_STATES.has(parts[2]) || !NOTE_KINDS.has(parts[3])) return undefined;
  return parts[2];
}

function noteTreeErrors(root) {
  const errors = [];
  const base = path.join(root, '.agents/notes');
  const baseStat = info(base, '.agents/notes');
  if (!baseStat) return errors;
  if (!baseStat.isDirectory()) return [issue('NOTE', '.agents/notes', '必须是目录。')];
  const report = (name, message) => errors.push(issue('NOTE', name, message));
  const sortByName = (left, right) => compare(left.name, right.name);
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true }).sort(sortByName);
  } catch (error) {
    fail('IO', '.agents/notes', `无法读取目录：${error.message}`);
  }
  for (const entry of entries) {
    if (entry.isFile()) {
      if (entry.name === 'AGENTS.md' || !entry.name.toLowerCase().endsWith('.md')) continue;
      report(
        `.agents/notes/${entry.name}`,
        entry.name.toLowerCase() === 'index.md'
          ? '禁止集中式 INDEX.md；活跃目录树即工作清单。'
          : '除 AGENTS.md 外，记录必须位于 {lifecycle}/{class}/ 目录。',
      );
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (!NOTE_STATES.has(entry.name)) {
      report(`.agents/notes/${entry.name}`, `未知生命周期目录“${entry.name}”；允许 proposed、implemented、rejected、archived。`);
      continue;
    }
    const lifecycle = path.join(base, entry.name);
    let children;
    try {
      children = readdirSync(lifecycle, { withFileTypes: true }).sort(sortByName);
    } catch (error) {
      fail('IO', `.agents/notes/${entry.name}`, `无法读取目录：${error.message}`);
    }
    for (const child of children) {
      if (child.isFile()) {
        if (child.name.toLowerCase().endsWith('.md') && child.name !== 'AGENTS.md') {
          report(`.agents/notes/${entry.name}/${child.name}`, '记录必须放在类别目录中，生命周期根只允许 AGENTS.md。');
        }
        continue;
      }
      if (!child.isDirectory()) continue;
      if (!NOTE_KINDS.has(child.name)) {
        report(`.agents/notes/${entry.name}/${child.name}`, `未知类别目录“${child.name}”；允许 ${[...NOTE_KINDS].join('、')}。`);
        continue;
      }
      let leaves;
      try {
        leaves = readdirSync(path.join(lifecycle, child.name), { withFileTypes: true }).sort(sortByName);
      } catch (error) {
        fail('IO', `.agents/notes/${entry.name}/${child.name}`, `无法读取目录：${error.message}`);
      }
      for (const leaf of leaves) {
        if (leaf.isDirectory()) {
          report(`.agents/notes/${entry.name}/${child.name}/${leaf.name}`, '类别目录下不再建立子目录。');
        }
      }
    }
  }
  return errors;
}

function noteErrors(file, text, document) {
  const state = noteState(file);
  if (state === undefined) return [];
  const parts = file.split('/');
  const errors = [];
  const report = (message, line) => errors.push(issue('NOTE', file, message, line));
  if (parts.length !== 5 || !NOTE_STATES.has(state) || !NOTE_KINDS.has(parts[3])) {
    report('决策记录路径必须为 .agents/notes/<proposed|implemented|rejected|archived>/<feature|bug-fix|simplification|architecture|process|testing>/YYYY-MM-DD-slug.md。');
  }
  const filename = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.exec(parts.at(-1));
  if (!filename || !validDate(filename[1])) report('决策记录文件名必须使用有效日期及小写英文/数字短横线 slug：YYYY-MM-DD-slug.md。');
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (!/^# 决策记录：\S.*$/.test(lines[0] ?? '')) report('第一行必须为“# 决策记录：标题”。', 1);
  if (lines[1] !== '') report('标题后必须有一个空行。', 2);
  const expected = state === 'archived' ? 'implemented' : state;
  const validStatus = state === 'rejected'
    ? /^Status: rejected — \S.*$/.test(lines[2] ?? '')
    : lines[2] === `Status: ${expected}`;
  if (NOTE_STATES.has(state) && !validStatus) {
    report(state === 'rejected' ? '第三行必须为“Status: rejected — 一行拒绝理由”。' : `第三行必须为“Status: ${expected}”，并与生命周期目录一致。`, 3);
  }
  if (state === 'archived') {
    const dates = lines.filter((line) => line.startsWith('Archived: '));
    if (dates.length !== 1 || lines[3] !== dates[0] || !validDate(dates[0].slice('Archived: '.length))) {
      report('归档日期必须紧接状态行，形式为唯一的“Archived: YYYY-MM-DD”，并使用有效日期。', 4);
    }
    return errors;
  }
  if (lines[3] !== '') report('状态行后必须有一个空行。', 4);
  const headings = document.headings.filter((heading) => heading.level === 2);
  if (headings[0]?.title !== '问题') report('正文第一个二级标题必须为“## 问题”。', headings[0]?.line);
  const sections = new Set(headings.map((heading) => heading.title));
  for (const section of NOTE_SECTIONS[state] ?? []) {
    if (!sections.has(section)) report(`缺少必选二级标题：## ${section}`);
  }
  if (state === 'implemented') {
    for (const heading of headings) {
      if (['提案', '计划', '迁移计划', '验收标准'].includes(heading.title)) report(`implemented 记录禁止保留“${heading.title}”章节。`, heading.line);
    }
  }
  return errors;
}

function linkErrors(root, file, links, load) {
  const errors = [];
  for (const link of links) {
    const url = link.target;
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(url) && !/^[A-Za-z]:/.test(url) && !/^file:/i.test(url)) continue;
    try {
      if (/^file:/i.test(url)) fail('PATH', file, `禁止绝对文件 URL：${url}`, link.line);
      const hash = url.indexOf('#');
      const before = hash === -1 ? url : url.slice(0, hash);
      const query = before.indexOf('?');
      const pathname = decodeURIComponent(query === -1 ? before : before.slice(0, query));
      const fragment = hash === -1 ? '' : decodeURIComponent(url.slice(hash + 1));
      const target = pathname ? inside(root, pathname, file, path.dirname(file)) : file;
      const stat = info(target, relative(root, target));
      if (!stat || !(stat.isFile() || stat.isDirectory())) {
        errors.push(issue('LINK', relative(root, file), `本地链接目标不存在或不是文件/目录：${url}`, link.line));
      } else if (fragment && path.extname(target).toLowerCase() === '.md' && stat.isFile() && !load(target).anchors.has(fragment)) {
        errors.push(issue('ANCHOR', relative(root, file), `Markdown 标题锚点不存在：${url}`, link.line));
      }
    } catch (error) {
      if (error instanceof Failure) {
        errors.push({ ...error.issue, file: relative(root, file), line: link.line });
      } else if (error instanceof URIError) {
        errors.push(issue('LINK', relative(root, file), `本地链接包含无效的百分号编码：${url}`, link.line));
      } else {
        throw error;
      }
    }
  }
  return errors;
}

function check(root, files) {
  const errors = noteTreeErrors(root);
  const documents = new Map();
  function load(file) {
    if (!documents.has(file)) {
      const name = relative(root, file);
      const text = readText(file, name);
      documents.set(file, { ...parseMarkdown(text, name), text });
    }
    return documents.get(file);
  }
  for (const file of files) {
    const name = relative(root, file);
    try {
      if (noteState(name) === 'archived') {
        errors.push(...noteErrors(name, readText(file, name)));
        continue;
      }
      const document = load(file);
      errors.push(...document.errors);
      const parsed = inlineLinks(document.prose, name);
      errors.push(...parsed.errors, ...linkErrors(root, file, parsed.links, load), ...noteErrors(name, document.text, document));
    } catch (error) {
      if (!(error instanceof Failure)) throw error;
      errors.push(error.issue);
    }
  }
  return errors;
}

function argumentsFor(args) {
  let root;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--root') {
      if (root !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) fail('USAGE', '命令行', '--root 必须且只能指定一次目录。');
      root = args[++index];
    } else {
      fail('USAGE', '命令行', `未知参数：${args[index]}。用法：pnpm docs:check [--root <目录>]`);
    }
  }
  return { root: path.resolve(root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) };
}

function run() {
  const args = argumentsFor(process.argv.slice(2));
  const stat = info(args.root, '--root');
  if (!stat?.isDirectory() || stat.isSymbolicLink()) fail('PATH', '--root', '仓库根目录必须是存在的真实目录，不能是符号链接。');
  const root = realpathSync(args.root);
  const files = markdownFiles(root);
  const errors = check(root, files);
  if (errors.length) {
    for (const error of errors) printIssue(error);
    process.exitCode = 1;
  } else {
    console.log(`文档检查通过：${files.length} 个 Markdown 文件。`);
  }
}

function printIssue(error) {
  console.error(`错误 [${error.code}] ${error.file}${error.line ? `:${error.line}` : ''}：${error.message}`);
}

try {
  run();
} catch (error) {
  printIssue(error instanceof Failure ? error.issue : issue('IO', '文档命令', error.message));
  process.exitCode = 1;
}
