import assert from 'node:assert/strict';
import { supabase } from '../src/reader/supabase.ts';
import { bookId, publishedContent, parsePublishedContent, contentNodes, nodeKey } from '../src/textbook/content.ts';

const { data, error } = await supabase.from('reader_books').select('revision,content').eq('book_id', bookId).single();
assert.ifError(error);
assert.deepEqual(parsePublishedContent(data.content), publishedContent());
const nodes = contentNodes(data.content, { supplements: [], notes: {} });
assert.equal(new Set(nodes.map((node) => node.key)).size, nodes.length);
assert.ok(nodes[0], 'Published content must contain a node');
const ref = { bookId, id: nodes[0].id };
assert.notEqual(nodeKey({ ...ref, source: 'default' }), nodeKey({ ...ref, source: 'personal' }));
const privateRead = await supabase.from('reader_personal').select('*');
assert.equal(privateRead.error?.code, '42501');
console.log(JSON.stringify({ defaultNodes: nodes.length, revision: data.revision, fullSourceEquality: true, anonymousPersonalRead: 'denied' }));
