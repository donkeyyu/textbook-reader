import { chapterSources } from './chapters.ts';
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
  additionalRegions?: {
    page: number;
    region: { x: number; y: number; width: number; height: number };
    sourceImageSha256: string;
  }[];
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
  questionGuide?: {
    continuous?: boolean;
    knowledgePoints: string[];
    method: string[];
    cautions: string[];
  };
  related: { locationId: string; label: string; purpose: string }[];
};

export type QuestionCoverage = {
  status: 'pending' | 'source-checked';
  basis: string;
  items: { label: string; page: number; supplementId: string; parts: string[] }[];
};

// Content and coordinates belong to this exact PDF, not merely the same book title.
if (chapterSources.some(({ chapter, positioning }) => chapter.documentSha256 !== book.documentSha256 || positioning.documentSha256 !== book.documentSha256)) {
  throw new Error('教材与补充说明的来源不匹配。');
}

const locations = new Map<string, TextbookLocation>(chapterSources.flatMap(({ positioning }) => positioning.locations).map((location: TextbookLocation) => [location.id, location]));

export function getLocation(id: string): TextbookLocation {
  const location = locations.get(id);
  if (!location) throw new Error(`教材位置不存在：${id}`);
  return location;
}
