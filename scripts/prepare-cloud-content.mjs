import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { publishedContent } from '../src/textbook/content.ts';

const target = process.argv[2];
if (!target) throw new Error('Pass an output SQL file. Run with node --experimental-strip-types.');
const content = publishedContent();
const raw = JSON.stringify(content);
const revision = createHash('sha256').update(raw).digest('hex');
const query = `insert into public.reader_books(book_id, revision, content)
values ('${content.documentSha256}', '${revision}', '${raw.replaceAll("'", "''")}'::jsonb)
on conflict (book_id) do update set revision = excluded.revision, content = excluded.content, updated_at = now()
where reader_books.revision is distinct from excluded.revision
returning book_id, revision, jsonb_array_length(content->'supplements') as nodes;\n`;
await writeFile(target, query);
console.log(JSON.stringify({ target, revision, nodes: content.supplements.length, characters: query.length }));
