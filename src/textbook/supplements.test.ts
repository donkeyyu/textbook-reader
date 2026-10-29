import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chapterSources } from './chapters.ts';
import book from './book.json' with { type: 'json' };
import { getLocation, type QuestionCoverage, type TextbookLocation } from './supplements.ts';
import { publishedContent, supplementQueries } from './content.ts';

const { getSupplement, supplementsForPage } = supplementQueries(publishedContent());

const index = (await readFile(new URL('../../materials/indexes/人教版-数学-七年级上册/index.jsonl', import.meta.url), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

for (const { chapter, positioning } of chapterSources) {
  test(`${chapter.chapter}: coverage and locations match the verified textbook index`, () => {
    assert.equal(chapter.documentSha256, book.documentSha256);
    assert.equal(positioning.documentSha256, book.documentSha256);
    const [start, end] = chapter.pageRange as [number, number];
    assert.deepEqual(chapter.pageDecisions.map(({ page }) => page), Array.from({ length: end - start + 1 }, (_, i) => i + start));
    for (const location of positioning.locations) {
      const page = index[location.page - 1];
      assert.equal(location.sourceImageSha256, page.page_image_sha256, location.id);
      assert.equal(location.printedPage, page.printed_page, location.id);
      assert.equal(location.anchorLabel, page.anchors[location.indexAnchor]?.label, location.id);
      assert.equal(page.document_sha256, positioning.documentSha256);
      assert.ok(location.page >= chapter.pageRange[0]! && location.page <= chapter.pageRange[1]!);
      const { x, y, width, height } = location.region;
      for (const value of [x, y, width, height, location.marker.x, location.marker.y]) {
        assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, location.id);
      }
      assert.ok(width > 0 && height > 0 && x + width <= 1 && y + height <= 1, location.id);
      assert.ok(location.marker.y >= y && location.marker.y <= y + height, location.id);
      for (const part of (location as TextbookLocation).additionalRegions ?? []) {
        assert.equal(part.sourceImageSha256, index[part.page - 1]?.page_image_sha256, location.id);
        assert.ok(part.page >= start && part.page <= end, location.id);
        const { x, y, width, height } = part.region;
        assert.ok([x, y, width, height].every(Number.isFinite), location.id);
        assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1, location.id);
      }
      assert.equal(getLocation(location.id), location);
    }
  });
}

test('every supplement and related link resolves to a source-bound location', () => {
  const locations = chapterSources.flatMap(({ positioning }) => positioning.locations);
  const supplements = chapterSources.flatMap(({ chapter }) => chapter.supplements);
  assert.equal(new Set(locations.map(({ id }) => id)).size, locations.length);
  assert.equal(new Set(supplements.map(({ id }) => id)).size, supplements.length);
  for (const supplement of supplements) {
    const location = getLocation(supplement.locationId);
    assert.equal(getSupplement(supplement.id), supplement);
    assert.ok(supplementsForPage(location.page).includes(supplement));
    for (const value of [supplement.title, supplement.preview, supplement.learningGap, supplement.learningAction, ...supplement.paragraphs]) {
      assert.ok(value.trim().length > 0, supplement.id);
    }
    for (const related of supplement.related) {
      assert.ok(getLocation(related.locationId));
      assert.ok(related.label && related.purpose);
    }
  }
  assert.deepEqual(supplementsForPage(1), []);
  assert.deepEqual(supplementsForPage(200), []);
  assert.equal(getSupplement('missing'), undefined);
  assert.throws(() => getLocation('missing'), /不存在/);
});

test('each inventoried question has its own complete guide and useful knowledge links', () => {
  for (const { chapter } of chapterSources) {
    const coverage = ('questionCoverage' in chapter ? chapter.questionCoverage : undefined) as QuestionCoverage | undefined;
    const guides = chapter.supplements.map(({ id }) => getSupplement(id)!).filter(({ questionGuide }) => questionGuide);
    if (!coverage) {
      assert.equal(guides.length, 0, `${chapter.chapter}: missing question inventory`);
      continue;
    }
    assert.ok(['pending', 'source-checked'].includes(coverage.status));
    assert.ok(coverage.basis.trim());
    if (coverage.status === 'source-checked') assert.ok(coverage.items.length > 0, chapter.chapter);
    assert.equal(new Set(coverage.items.map(({ page, label }) => `${page}:${label}`)).size, coverage.items.length);
    assert.equal(new Set(coverage.items.map(({ supplementId }) => supplementId)).size, coverage.items.length);
    assert.deepEqual(new Set(guides.map(({ id }) => id)), new Set(coverage.items.map(({ supplementId }) => supplementId)), chapter.chapter);
    for (const item of coverage.items) {
      const note = getSupplement(item.supplementId)!;
      assert.ok(note?.questionGuide, item.supplementId);
      assert.ok(item.label.trim());
      assert.ok(Array.isArray(item.parts) && item.parts.every((part) => part.trim()));
      assert.equal(new Set(item.parts).size, item.parts.length, item.label);
      assert.equal(getLocation(note.locationId).page, item.page, item.label);
      for (const values of [note.questionGuide.knowledgePoints, note.questionGuide.method, note.questionGuide.cautions]) {
        assert.ok(Array.isArray(values) && values.length > 0 && values.every((value) => value.trim()), item.label);
      }
      assert.ok(note.related.length > 0, `${item.label}: missing knowledge link`);
      assert.ok(note.related.every(({ locationId }) => locationId !== note.locationId), `${item.label}: self link`);
    }
  }
});

test('multi-line and continuation questions keep their full source regions', () => {
  const reservoir = getLocation('ch1-practice-p5-1').region;
  // PDF 12: the second answer blank ends at y=516; question 2 starts at y=533.
  assert.ok(reservoir.y * 1843 < 434);
  assert.ok((reservoir.y + reservoir.height) * 1843 >= 516);
  assert.ok((reservoir.y + reservoir.height) * 1843 < 533);
  const continuation = getLocation('ch1-measurement-exercise').additionalRegions;
  assert.equal(continuation?.length, 1);
  assert.equal(continuation[0]?.page, 13);
  assert.ok(continuation[0]!.region.y < 0.1);
  const diagram = getLocation('ch1-order-without-scale').additionalRegions;
  assert.equal(diagram?.[0]?.page, 30);
  assert.ok(diagram[0]!.region.y + diagram[0]!.region.height < 0.137, 'exclude the next question');
});
