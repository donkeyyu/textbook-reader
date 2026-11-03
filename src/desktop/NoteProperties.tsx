import { useEffect, useRef, useState } from 'react';
import { stringify } from 'yaml';
import type { PropertyType } from '../../desktop/contracts';
import { deleteUserProperty, inferPropertyType, inspectProperties, propertyNumber, propertyTypeLabels, setUserProperty } from '../../desktop/properties';
import './properties.css';

const types = Object.keys(propertyTypeLabels) as PropertyType[];
const display = (value: unknown) => typeof value === 'string' ? value : (stringify(value) ?? '无法显示的值').trimEnd();

function NumberValue({ value, label, onChange }: { value: number; label: string; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState('');
  const focused = useRef(false);
  const currentText = useRef(text);
  useEffect(() => {
    if (focused.current && propertyNumber(currentText.current) === value) return;
    currentText.current = String(value); setText(currentText.current);
  }, [value]);
  return <div className="note-property-number"><input aria-label={label} type="text" inputMode="decimal" value={text} aria-invalid={!!error}
    onFocus={() => { focused.current = true; }} onChange={(event) => {
      currentText.current = event.target.value; setText(currentText.current); setError('');
      const number = propertyNumber(currentText.current);
      if (number !== undefined) onChange(number);
    }} onBlur={() => {
      focused.current = false;
      if (propertyNumber(currentText.current) === undefined) setError('请输入完整数值；已恢复上一个有效值。');
      currentText.current = String(value); setText(currentText.current);
    }} />{error && <p className="note-property-error" role="alert">{error}</p>}</div>;
}

function ScalarValue({ value, label, onChange }: { value: unknown; label: string; onChange: (value: unknown) => void }) {
  const kind = inferPropertyType(value);
  if (kind === 'number') return <NumberValue value={value as number} label={label} onChange={onChange} />;
  if (kind === 'boolean') return <input type="checkbox" aria-label={label} checked={value === true} onChange={(event) => onChange(event.target.checked)} />;
  if (kind === 'object' || kind === 'list') return <div className="note-property-nested" aria-label={label}><pre>{display(value)}</pre><small>嵌套值请在文件头源码中修改</small></div>;
  return <input aria-label={label} type={kind === 'date' ? 'date' : 'text'} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />;
}

function PropertyValue({ value, name, onChange }: { value: unknown; name: string; onChange: (value: unknown) => void }) {
  if (!Array.isArray(value)) return <ScalarValue value={value} label={`属性值 ${name}`} onChange={onChange} />;
  return <div className="note-property-list">{value.map((item: unknown, index: number) => <div key={index}>
    <ScalarValue value={item} label={`属性 ${name} 第 ${index + 1} 项`} onChange={(next) => onChange(value.map((original: unknown, position: number) => position === index ? next : original))} />
    <button type="button" aria-label={`删除属性 ${name} 第 ${index + 1} 项`} onClick={() => onChange(value.filter((_: unknown, position: number) => position !== index))}>×</button>
  </div>)}<button type="button" onClick={() => onChange([...value, ''])} aria-label={`添加属性 ${name} 列表项`}>添加列表项</button></div>;
}

export function NoteProperties({ source, readOnly, propertyTypes, onChange, onTypeChange, showProperties = true, unsupportedPropertyTypes = [] }: {
  source: string; readOnly: boolean; showProperties?: boolean; unsupportedPropertyTypes?: string[]; propertyTypes: Record<string, PropertyType>;
  onChange: (source: string) => void; onTypeChange: (name: string, type: PropertyType) => void;
}) {
  const { properties, problem } = inspectProperties(source);
  const [name, setName] = useState('');
  const [newType, setNewType] = useState<PropertyType>('text');
  const [error, setError] = useState('');
  const propertyName = name.trim();
  const sharedType = Object.hasOwn(propertyTypes, propertyName) ? propertyTypes[propertyName] : undefined;
  const creationType = sharedType ?? newType;
  useEffect(() => {
    for (const property of properties) {
      if (property.editable && !Object.hasOwn(propertyTypes, property.name) && !unsupportedPropertyTypes.includes(property.name)) onTypeChange(property.name, inferPropertyType(property.value));
    }
  }, [source, propertyTypes, unsupportedPropertyTypes, onTypeChange]);
  function mutate(operation: () => string) {
    try { onChange(operation()); setError(''); return true; }
    catch (cause) { setError((cause as Error).message); return false; }
  }
  return <section className="note-properties" aria-label="笔记属性">
    <div hidden={!showProperties}>{!problem && <>
      <div className="note-property-rows">{properties.map(({ name: propertyName, value, editable }) => {
        const actualType = inferPropertyType(value);
        const type = Object.hasOwn(propertyTypes, propertyName) ? propertyTypes[propertyName]! : actualType;
        const mismatch = type !== actualType;
        return <div className="note-property" key={propertyName}>
          <strong>{propertyName}</strong>
          {readOnly || !editable ? <><span className="note-property-type">{propertyTypeLabels[type]}</span><pre>{display(value)}</pre></> : <>
            <select aria-label={`属性类型 ${propertyName}`} value={unsupportedPropertyTypes.includes(propertyName) ? 'unsupported' : type} onChange={(event) => onTypeChange(propertyName, event.target.value as PropertyType)}>{unsupportedPropertyTypes.includes(propertyName) && <option value="unsupported" disabled>未支持</option>}{types.map((option) => <option key={option} value={option}>{propertyTypeLabels[option]}</option>)}</select>
            <PropertyValue value={value} name={propertyName} onChange={(next) => mutate(() => setUserProperty(source, propertyName, next))} />
            <button type="button" aria-label={`删除属性 ${propertyName}`} onClick={() => mutate(() => deleteUserProperty(source, propertyName))}>删除</button>
          </>}
          {unsupportedPropertyTypes.includes(propertyName) && <p className="note-property-mismatch" role="note">此属性的显示类型尚不支持，原配置已保留。可明确选择新的显示类型。</p>}
          {mismatch && <p className="note-property-mismatch" role="note">显示类型为{propertyTypeLabels[type]}；文件值是{propertyTypeLabels[actualType]}，未转换。</p>}
        </div>;
      })}</div>
      {!properties.length && readOnly && <p>没有用户属性</p>}
      {!readOnly && <details className="note-property-create"><summary>新增属性</summary><form className="note-property-add" onSubmit={(event) => {
        event.preventDefault();
        const defaults: Record<PropertyType, unknown> = { text: '', number: 0, boolean: false, list: [], date: new Date().toISOString().slice(0, 10), object: {} };
        if (mutate(() => setUserProperty(source, propertyName, defaults[creationType], true))) {
          if (sharedType === undefined && !unsupportedPropertyTypes.includes(propertyName)) onTypeChange(propertyName, creationType);
          setName('');
        }
      }}><input aria-label="新增属性名" placeholder="属性名" value={name} onChange={(event) => setName(event.target.value)} />
        <select aria-label="新增属性类型" value={creationType} disabled={sharedType !== undefined} title={sharedType === undefined ? undefined : '沿用本库同名属性类型'} onChange={(event) => setNewType(event.target.value as PropertyType)}>{types.map((type) => <option key={type} value={type}>{propertyTypeLabels[type]}</option>)}</select>
        <button type="submit" disabled={!name.trim()}>添加属性</button>
      </form></details>}
    </>}
    {problem && <p role="alert">属性暂不可用，请修复文件头格式。</p>}
    {error && <p className="note-property-error" role="alert">{error}</p>}</div>
  </section>;
}

export function NoteInformation({ source, path, fileMtime }: { source: string; path: string; fileMtime?: number }) {
  const { metadata } = inspectProperties(source);
  return <div className="note-information-content"><dl>
    <div><dt>文件</dt><dd>{path}</dd></div>
    {([['id', '笔记 ID'], ['create_time', '创建时间'], ['update_time', '更新时间']] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{metadata[key] === undefined ? '未知' : display(metadata[key])}</dd></div>)}
    {fileMtime !== undefined && <div><dt>文件修改时间</dt><dd>{new Date(fileMtime).toLocaleString()}</dd></div>}
  </dl>{metadata.ai_source !== undefined && <details><summary>AI 初始来源</summary><pre>{display(metadata.ai_source)}</pre></details>}</div>;
}
