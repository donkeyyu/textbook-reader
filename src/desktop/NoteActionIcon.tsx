const paths = {
  add: 'M12 4v16M4 12h16',
  refresh: 'M20 8a8 8 0 1 0 0 8M20 3v5h-5',
  edit: 'm15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-3-3L5 16l-1 4Z',
  preview: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  live: 'M4 4h16v16H4ZM12 4v16M7 8h2M7 12h2M7 16h2m6-8 3 4-3 4',
  list: 'M8 5h12M8 12h12M8 19h12M4 5h.01M4 12h.01M4 19h.01',
  properties: 'M9 3H5v18h4M15 3h4v18h-4M9 8h6M9 12h6M9 16h6',
  save: 'M4 3h13l4 4v14H3V3ZM7 3v6h10V3M7 21v-8h10v8',
  move: 'M3 7V4h7l2 3h9v13H3ZM7 13h10m-3-3 3 3-3 3',
  copy: 'M9 9h12v12H9ZM15 9V3H3v12h6',
  info: 'M12 8h.01M12 11v6M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  close: 'm6 6 12 12M6 18 18 6',
  back: 'm14 6-6 6 6 6',
} as const;
export function NoteActionIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={paths[name]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
