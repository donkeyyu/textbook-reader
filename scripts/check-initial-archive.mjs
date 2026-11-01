// Read-only verification. Only a full remote JSON match can produce this evidence.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { supabase } from '../src/account/supabase.ts';
import { canonical, checkPackage } from '../desktop/initial-package.ts';
const pack = checkPackage(JSON.parse(await readFile('resources/initial-notes/grade-7-volume-1.json', 'utf8')));
const { data, error } = await supabase.from('reader_initial_versions').select('textbook,version,package,archived_at').eq('textbook', pack.textbook).eq('version', pack.version).single();
assert.ifError(error);
assert.equal(canonical(data.package), canonical(pack), 'Cloud archive differs from the fixed initial package');
await mkdir('output/initial-notes', { recursive: true });
const receipt = { textbook: data.textbook, version: data.version, archivedAt: data.archived_at, verifiedAt: new Date().toISOString(), table: 'reader_initial_versions', fullPackageEquality: true };
await writeFile('output/initial-notes/verified-cloud-archive.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
