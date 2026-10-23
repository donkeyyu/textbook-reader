import chapter1 from '../../content/grade-7-volume-1/chapter-1.json' with { type: 'json' };
import locations1 from '../../content/grade-7-volume-1/locations.json' with { type: 'json' };
import chapter2 from '../../content/grade-7-volume-1/chapter-2.json' with { type: 'json' };
import locations2 from '../../content/grade-7-volume-1/chapter-2.locations.json' with { type: 'json' };
import chapter3 from '../../content/grade-7-volume-1/chapter-3.json' with { type: 'json' };
import locations3 from '../../content/grade-7-volume-1/chapter-3.locations.json' with { type: 'json' };
import chapter4 from '../../content/grade-7-volume-1/chapter-4.json' with { type: 'json' };
import locations4 from '../../content/grade-7-volume-1/chapter-4.locations.json' with { type: 'json' };
import chapter5 from '../../content/grade-7-volume-1/chapter-5.json' with { type: 'json' };
import locations5 from '../../content/grade-7-volume-1/chapter-5.locations.json' with { type: 'json' };
import chapter6 from '../../content/grade-7-volume-1/chapter-6.json' with { type: 'json' };
import locations6 from '../../content/grade-7-volume-1/chapter-6.locations.json' with { type: 'json' };

export const chapterSources = [
  { chapter: chapter1, positioning: locations1 },
  { chapter: chapter2, positioning: locations2 },
  { chapter: chapter3, positioning: locations3 },
  { chapter: chapter4, positioning: locations4 },
  { chapter: chapter5, positioning: locations5 },
  { chapter: chapter6, positioning: locations6 },
];
