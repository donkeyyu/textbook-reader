import assert from 'node:assert/strict';
import { searchGraph } from './check-supplement-graph.mjs';

// Run against the dev reader with graph visible and textbook hidden.
export async function checkGraphAutoLocate(page) {
  const fixtures = await page.evaluate(async () => {
    const { contentNodes, publishedContent } = await import('/src/textbook/content.ts');
    const nodes = contentNodes(publishedContent(), { supplements: [], notes: {} });
    return [nodes.find((n) => n.location.page < 20), nodes.find((n) => n.location.page > 100)]
      .map(({ key, title, location }) => ({ key, title, location }));
  });
  const currentPage = () => page.evaluate(() => document.querySelector('.page-index span').textContent);
  const before = await currentPage();
  await searchGraph(page, fixtures[0].title, fixtures[0].key);
  assert.equal(await currentPage(), before, 'Hidden textbook stays in place');
  await page.click('#graph-book-toggle');
  const located = async (fixture) => {
    await page.waitForFunction(({ location }) => {
      const box = document.getElementById(`location-${location.locationId}`)?.getBoundingClientRect();
      const book = document.getElementById('textbook-view').getBoundingClientRect();
      const current = Number(document.querySelector('.page-index span').textContent.split('/')[0]);
      return current === location.page && box && box.bottom > book.top && box.top < book.bottom;
    }, fixture);
  };
  await located(fixtures[0]);
  await searchGraph(page, fixtures[1].title, fixtures[1].key);
  await located(fixtures[1]);
  return { hiddenSelectionPreservesPage: true, showingBookLocatesSelection: true,
    visibleSelectionLocates: true, pages: fixtures.map((f) => f.location.page) };
}
