import { randomUUID } from 'node:crypto';
import { isMap, LineCounter, parseDocument, YAMLMap } from 'yaml';

function split(source: string) {
  const start = /^(\uFEFF?)---\r?\n/.exec(source);
  if (!start) return { prefix: source.startsWith('\uFEFF') ? '\uFEFF' : '', header: '', body: source.replace(/^\uFEFF/, ''), newline: '\n' };
  const end = /^(?:---|\.\.\.)\r?$/m.exec(source.slice(start[0].length));
  if (!end) throw new Error('YAML 第 1 行：文件头缺少结束的 ---。');
  const offset = start[0].length + end.index + end[0].length;
  return { prefix: start[1]!, header: source.slice(start[0].length, start[0].length + end.index),
    body: source.slice(offset).replace(/^\r?\n/, ''), newline: start[0].endsWith('\r\n') ? '\r\n' : '\n' };
}

function parse(source: string) {
  const parts = split(source);
  const lineCounter = new LineCounter();
  const doc = parseDocument(parts.header, { lineCounter, uniqueKeys: true, version: '1.2' });
  if (doc.errors.length) {
    const err = doc.errors[0]!;
    const pos = lineCounter.linePos(err.pos[0]);
    throw new Error(`YAML 第 ${pos.line + 1} 行，第 ${pos.col} 列：${err.message.split('\n')[0]}`);
  }
  if (doc.contents !== null && !isMap(doc.contents)) throw new Error('YAML 文件头必须是属性对象。');
  // Resolving aliases here detects recursive or excessively expanded input before comparison.
  const data = doc.toJS({ maxAliasCount: 50 }) ?? {};
  try { JSON.stringify(data); } catch { throw new Error('YAML 不支持循环引用。'); }
  const meta = doc.get('_textbook', true);
  if (meta !== undefined && !isMap(meta)) throw new Error('_textbook 必须是对象，原值已保留。');
  return { ...parts, doc, data, meta: meta as YAMLMap | undefined };
}

function validTime(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return false;
  const date = value.slice(0, 10);
  const day = Number(date.slice(8));
  const month = Number(date.slice(5, 7));
  const year = Number(date.slice(0, 4));
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function inspect(source: string) {
  const problems: string[] = [];
  try {
    const { meta } = parse(source);
    const version = meta?.get('schema_version');
    const id = meta?.get('id');
    const newer = typeof version === 'number' && version > 1;
    if (newer) problems.push('此笔记使用较新格式，只读打开。');
    else if (version !== undefined && version !== 1) problems.push('_textbook.schema_version 应为整数 1。');
    if (id !== undefined && (typeof id !== 'string' || !id.trim())) problems.push('_textbook.id 应为非空字符串；请在源码中明确修复后保存。');
    for (const name of ['create_time', 'update_time']) {
      const value = meta?.get(name);
      if (value !== undefined && !validTime(value)) problems.push(`_textbook.${name} 格式异常；保留原值，请核对。`);
    }
    return { readOnly: newer, problems, id: typeof id === 'string' && id.trim() ? id : undefined };
  } catch (error) {
    return { readOnly: false, problems: [(error as Error).message], id: undefined };
  }
}

function content(source: string) {
  const { data, body } = parse(source);
  const { _textbook, ...properties } = data;
  return JSON.stringify({ body, properties, anchors: _textbook?.anchors });
}

export function prepareSave(original: string | null, source: string, now = new Date().toISOString()) {
  const status = inspect(source);
  if (status.readOnly) throw new Error(status.problems[0]);
  const parsed = parse(source);
  const { doc } = parsed;
  let meta = parsed.meta;
  const version = meta?.get('schema_version');
  const id = meta?.get('id');
  if (version !== undefined && version !== 1) throw new Error('格式版本异常，请在源码中修复。');
  if (id !== undefined && (typeof id !== 'string' || !id.trim())) throw new Error('ID 异常，未保存；原值未改写。');
  if (original !== null && inspect(original).readOnly) throw new Error('较新格式不可保存。');
  if (!meta) { meta = new YAMLMap(); doc.set('_textbook', meta); }
  if (version === undefined) meta.set('schema_version', 1);
  const previousId = original === null ? undefined : inspect(original).id;
  if (id === undefined) meta.set('id', previousId ?? randomUUID());
  let changed = original === null;
  if (original !== null) {
    try { changed = content(original) !== content(source); }
    catch { changed = true; } // A user can repair invalid YAML explicitly in source.
  }
  const setTime = (name: string) => {
    const previous = meta.get(name);
    if (previous !== undefined && !validTime(previous)) return;
    const scalar = doc.createNode(now);
    scalar.type = 'QUOTE_DOUBLE';
    meta.set(name, scalar);
  };
  if (original === null) { setTime('create_time'); setTime('update_time'); }
  else if (changed) setTime('update_time');
  const header = doc.toString({ lineWidth: 0 }).replace(/\n/g, parsed.newline);
  return `${parsed.prefix}---${parsed.newline}${header}---${parsed.newline}${parsed.body}`;
}
