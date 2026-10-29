import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { bookId, publishedContent } from '../src/textbook/content.ts';

const target = process.argv[2];
if (!target) throw new Error('Pass an output SQL file. Run with node --experimental-strip-types.');
const content = publishedContent();
const raw = JSON.stringify(content);
const revision = createHash('sha256').update(raw).digest('hex');

// 第二个参数给出条目 id 清单（JSON 数组）时只替换这些条目，用于逐页修订后的小补丁。
const idListFile = process.argv[3];
let query;
if (idListFile) {
  /** @type {string[]} */
  const ids = JSON.parse(await readFile(idListFile, 'utf8'));
  /** @type {Record<string, unknown>} */
  const map = {};
  for (const id of ids) {
    const note = content.supplements.find((item) => item.id === id);
    if (!note) throw new Error(`补充条目不存在：${id}`);
    map[id] = note;
  }
  const patch = JSON.stringify(map).replaceAll("'", "''");
  query = `update public.reader_books rb
set content = jsonb_set(rb.content, '{supplements}', (
      select jsonb_agg(coalesce(patch.map -> (item.value ->> 'id'), item.value) order by item.ord)
      from jsonb_array_elements(rb.content -> 'supplements') with ordinality as item(value, ord)
      cross join (select '${patch}'::jsonb as map) patch
    )),
  revision = '${revision}',
  updated_at = now()
where rb.book_id = '${bookId}'
returning revision, jsonb_array_length(content -> 'supplements') as nodes;\n`;
} else {
  query = `insert into public.reader_books(book_id, revision, content)
values ('${content.documentSha256}', '${revision}', '${raw.replaceAll("'", "''")}'::jsonb)
on conflict (book_id) do update set revision = excluded.revision, content = excluded.content, updated_at = now()
where reader_books.revision is distinct from excluded.revision
returning book_id, revision, jsonb_array_length(content->'supplements') as nodes;\n`;
}
await writeFile(target, query);
console.log(JSON.stringify({ target, revision, nodes: content.supplements.length, characters: query.length }));
