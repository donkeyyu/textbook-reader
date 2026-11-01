import { isAlias, isMap, isNode, isScalar } from 'yaml';
import { parse } from './format.ts';
import type { PropertyType } from './contracts.ts';

export const propertyTypeLabels: Record<PropertyType, string> = {
  text: '文本', number: '数值', boolean: '开关', list: '列表', date: '日期', object: '对象',
};

export function propertyNumber(text: string): number | undefined {
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export function inferPropertyType(value: unknown): PropertyType {
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value) return 'date';
  return 'text';
}

export function inspectProperties(source: string) {
  try {
    const { doc, data } = parse(source);
    const properties = (isMap(doc.contents) ? doc.contents.items : []).map((pair) => ({
      name: isScalar(pair.key) ? String(pair.key.value) : String(pair.key),
      value: isScalar(pair.key) && typeof pair.key.value === 'string' ? data[pair.key.value] as unknown : String(pair.value),
      editable: isScalar(pair.key) && typeof pair.key.value === 'string',
    })).filter((item) => item.name !== '_textbook');
    const metadata: Record<string, unknown> = data._textbook ?? {};
    return { properties, metadata, anchors: metadata.anchors, problem: '' };
  } catch (cause) {
    return { properties: [], metadata: {} as Record<string, unknown>, anchors: undefined, problem: (cause as Error).message };
  }
}

function checkName(name: string) {
  if (!name.trim() || name === '_textbook') throw new Error('请输入用户属性名；_textbook 是保留对象。');
}

function serialize(parsed: ReturnType<typeof parse>) {
  const next = `${parsed.prefix}---${parsed.newline}${parsed.doc.toString({ lineWidth: 0 }).replace(/\n/g, parsed.newline)}---${parsed.newline}${parsed.body}`;
  // A deleted anchor may still have YAML aliases. Keep the source until repaired.
  parse(next);
  return next;
}

export function setUserProperty(source: string, name: string, value: unknown, create = false) {
  checkName(name);
  const parsed = parse(source);
  if (create && parsed.doc.has(name)) throw new Error(`属性“${name}”已存在。`);
  const previous = parsed.doc.get(name, true);
  const node = parsed.doc.createNode(value);
  if (isNode(previous)) {
    node.comment = previous.comment;
    node.commentBefore = previous.commentBefore;
    node.spaceBefore = previous.spaceBefore;
    if (!isAlias(previous) && previous.anchor) node.anchor = previous.anchor;
  }
  parsed.doc.set(name, node);
  return serialize(parsed);
}

export function deleteUserProperty(source: string, name: string) {
  checkName(name);
  const parsed = parse(source);
  parsed.doc.delete(name);
  return serialize(parsed);
}
