// Generates a fixed package and an insert-only archive deployment script; never publishes.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';

import { transformWithOxc } from 'vite';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { publishedContent, supplementKind } from '../src/textbook/content.ts';
import { getLocation } from '../src/textbook/supplements.ts';
import { initialBody, packageVersion } from '../desktop/initial-package.ts';

const content = publishedContent();
const locations = Object.fromEntries(content.supplements.flatMap((note) => [note.locationId, ...note.related.map((link) => link.locationId)]).map((id) => [id, getLocation(id)]));
const diagrams = ['ch3-q-p88-example4', 'ch3-triangle-base-height', 'ch3-area-value-unit'];
const captions = [String.raw`三角形面积 $\frac12 ab$，圆孔面积 $\pi r^2$，三角尺面积 $S=\frac12 ab-\pi r^2$。补充示意，不按实际尺寸比例绘制。`, String.raw`两块全等，沿斜边拼成长方形；每块占一半，$S_{\text{三角形}}=\frac12 ab$。a 与 b 互相垂直。`, String.raw`每格 $1\ \mathrm{mm}\times1\ \mathrm{mm}=1\ \mathrm{mm}^2$，10 行，每行 10 格，$1\ \mathrm{cm}^2=100\ \mathrm{mm}^2$。补充用例：面积单位换算。`];
const input = (await readFile(new URL('../src/reader/supplements/AreaDiagrams.tsx', import.meta.url), 'utf8')).replace("import { MathText } from '../text/MathText';", 'const MathText = ({text}: {text: string}) => text;');
const temporary = new URL('../.initial-diagrams.mjs', import.meta.url);
await writeFile(temporary, (await transformWithOxc(input, 'AreaDiagrams.tsx', { jsx: { runtime: 'automatic' } })).code);
/** @type {Record<string, string>} */
const images = {};
try {
  const { SupplementDiagram } = await import(temporary.href);
  await mkdir('src/desktop/initial-diagrams', { recursive: true });
  for (const id of diagrams) {
    const html = renderToStaticMarkup(createElement(SupplementDiagram, { supplementId: id }));
    const rawSvg = html.match(/<svg[\s\S]*?<\/svg>/)?.[0];
    if (!rawSvg) throw new Error(`Diagram missing: ${id}`);
    const svg = rawSvg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replaceAll('currentColor', '#4b3d32').replaceAll('var(--diagram-triangle)', '#cfe5d6').replaceAll('var(--diagram-circle)', '#f4dfaa').replaceAll('var(--diagram-copy)', '#e1d9ee');
    images[id] = svg;
    await writeFile(`src/desktop/initial-diagrams/${id}.svg`, svg);
  }
} finally { await rm(temporary, { force: true }); }
/** @param {string} text */
const safe = (text) => [...text].map((character) => character.charCodeAt(0) < 32 ? '－' : character).join('').replace(/[\\/:<>"|?*]/g, '－').replace(/[. ]+$/, '').slice(0, 90) || '未命名';
const entries = content.supplements.map((note) => {
  const location = getLocation(note.locationId);
  const chapter = content.chapters.find((item) => location.page >= item.start && location.page <= item.end);
  /** @param {{page: number, region: {x: number, y: number, width: number, height: number}}} part */
  const anchor = (part) => ({ textbook: content.documentSha256, chapter: content.chapters.find((item) => part.page >= item.start && part.page <= item.end)?.id, section: content.sections.find((item) => part.page >= item.start && part.page <= item.end)?.id, pdf_page: part.page, rects: [[part.region.x, part.region.y, part.region.width, part.region.height]] });
  let body = initialBody(note);
  const imageIndex = diagrams.indexOf(note.id);
  if (imageIndex !== -1) body += `![${note.title}的补充示意](/initial-diagrams/${note.id}.svg)\n\n${captions[imageIndex]}\n\n`;
  return { sourceId: note.id, title: note.title, type: supplementKind(note), path: `数学·七年级上册/${safe(chapter?.title ?? '其他')}/${safe(note.title)}.md`, body, anchors: [anchor(location), ...(location.additionalRegions ?? []).map(anchor)] };
});
const source = { content, locations, diagrams: images };
const version = packageVersion({ source, entries });
const pack = { schemaVersion: 1, textbook: content.documentSha256, version, archive: { table: 'reader_initial_versions', state: 'unpublished' }, source, entries };
await mkdir('resources/initial-notes', { recursive: true });
await writeFile('resources/initial-notes/grade-7-volume-1.json', JSON.stringify(pack, null, 2) + '\n');
const quoted = JSON.stringify(pack).replaceAll("'", "''");
const schema = await readFile('scripts/initial-notes-archive-schema.sql', 'utf8');
await mkdir('output/initial-notes', { recursive: true });
await writeFile('output/initial-notes/deploy-archive.sql', `${schema}\ninsert into public.reader_initial_versions (textbook, version, package) values ('${pack.textbook}', '${version}', '${quoted}'::jsonb) on conflict (textbook, version) do nothing;\n-- Must compare returned JSON to the fixed package before recording a publication receipt.\nselect textbook, version, package from public.reader_initial_versions where textbook = '${pack.textbook}' and version = '${version}';\n`);
console.log(JSON.stringify({ version, entries: entries.length, archive: 'unpublished', deployment: 'output/initial-notes/deploy-archive.sql' }));
