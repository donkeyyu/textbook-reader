import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import chapter from '../../content/grade-7-volume-1/chapter-1.json' with { type: 'json' };
import positioning from '../../content/grade-7-volume-1/locations.json' with { type: 'json' };
import book from './book.json' with { type: 'json' };
import { getLocation, getSupplement, locationsForPage, supplementsForPage } from './supplements.ts';

const index = (await readFile(new URL('../../materials/indexes/人教版-数学-七年级上册/index.jsonl', import.meta.url), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

test('chapter coverage and all locations match the verified textbook index', () => {
  assert.equal(chapter.documentSha256, book.documentSha256);
  assert.equal(positioning.documentSha256, book.documentSha256);
  assert.deepEqual(chapter.pageRange, [8, 30]);
  assert.deepEqual(chapter.pageDecisions.map(({ page }) => page), Array.from({ length: 23 }, (_, i) => i + 8));
  assert.equal(new Set(positioning.locations.map(({ id }) => id)).size, positioning.locations.length);
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
    assert.ok(locationsForPage(location.page).some(({ id }) => id === location.id));
  }
});

test('every supplement and related link resolves to a source-bound location', () => {
  assert.equal(new Set(chapter.supplements.map(({ id }) => id)).size, chapter.supplements.length);
  for (const supplement of chapter.supplements) {
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
  assert.deepEqual(supplementsForPage(31), []);
  assert.equal(getSupplement('missing'), undefined);
  assert.throws(() => getLocation('missing'), /不存在/);
});
