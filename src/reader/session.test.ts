import assert from 'node:assert/strict';
import test from 'node:test';
import { readingPage, restoredScroll } from './session.ts';
import { groupMarkers } from './marker-groups.ts';

const pages = [{ top: 32, height: 900 }, { top: 956, height: 900 }, { top: 1880, height: 500 }];

test('scrolling updates the page at the reading line in both directions', () => {
  assert.equal(readingPage(pages, 0, 800, 2412), 1);
  assert.equal(readingPage(pages, 900, 800, 2412), 2);
  assert.equal(readingPage(pages, 400, 800, 2412), 1);
  assert.equal(readingPage(pages, 716, 800, 2412), 2);
});

test('the last page is selected at the bottom even when shorter than the viewport', () => {
  assert.equal(readingPage(pages, 1612, 800, 2412), 3);
  assert.equal(readingPage([{ top: 0, height: 100 }], 0, 800, 100), 1);
});

test('width changes preserve the page-relative reading position, including page margins', () => {
  assert.equal(restoredScroll({ top: 1600, height: 1000 }, .4), 2000);
  assert.equal(restoredScroll({ top: 800, height: 500 }, .4), 1000);
  assert.equal(restoredScroll({ top: 800, height: 500 }, -.1), 750);
  assert.equal(restoredScroll({ top: 32, height: 500 }, -.2), 0);
});

test('overlapping markers merge without losing questions and separate again at a larger scale', () => {
  const markers = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 100, y: 125 }, { id: 'c', x: 100, y: 150 }, { id: 'left', x: 10, y: 125 }];
  assert.deepEqual(groupMarkers(markers, 36).map((group) => group.map(({ id }) => id)), [['a', 'b', 'c'], ['left']]);
  assert.equal(groupMarkers(markers.map((marker) => ({ ...marker, x: marker.x * 2, y: marker.y * 2 })), 36).length, 4);
  assert.equal(groupMarkers([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 36, y: 0 }], 36).length, 2);
});
