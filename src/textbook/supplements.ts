import chapter from '../../content/grade-7-volume-1/chapter-1.json' with { type: 'json' };
import positioning from '../../content/grade-7-volume-1/locations.json' with { type: 'json' };
import book from './book.json' with { type: 'json' };

export type TextbookLocation = {
  id: string;
  page: number;
  printedPage: string | null;
  indexAnchor: number;
  anchorLabel: string;
  locator: string;
  region: { x: number; y: number; width: number; height: number };
  marker: { x: number; y: number };
  sourceImageSha256: string;
};

export type Supplement = {
  id: string;
  locationId: string;
  title: string;
  preview: string;
  paragraphs: string[];
  learningRole: string;
  learningGap: string;
  learningAction: string;
  related: { locationId: string; label: string; purpose: string }[];
};

// Content and coordinates belong to this exact PDF, not merely the same book title.
if (chapter.documentSha256 !== book.documentSha256 || positioning.documentSha256 !== book.documentSha256) {
  throw new Error('教材与补充说明的来源不匹配。');
}

const locations = new Map<string, TextbookLocation>(positioning.locations.map((location: TextbookLocation) => [location.id, location]));
const supplements = new Map<string, Supplement>(chapter.supplements.map((supplement: Supplement) => [supplement.id, supplement]));

export function getLocation(id: string): TextbookLocation {
  const location = locations.get(id);
  if (!location) throw new Error(`教材位置不存在：${id}`);
  return location;
}

export function getSupplement(id: string): Supplement | undefined {
  return supplements.get(id);
}

export function supplementsForPage(page: number): Supplement[] {
  return [...supplements.values()].filter((supplement) => getLocation(supplement.locationId).page === page);
}

export function locationsForPage(page: number): TextbookLocation[] {
  return [...locations.values()].filter((location) => location.page === page);
}
