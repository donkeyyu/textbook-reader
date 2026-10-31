import { supabase } from '../account/supabase.ts';
import { bookId, parsePublishedContent, publishedContent, type PublishedContent } from './content.ts';

// Opt-in authoring preview; production always reads the published content.
export const localContentPreview = import.meta.env?.DEV === true && new URLSearchParams(window.location.search).get('content') === 'local';

export async function readPublishedContent(): Promise<PublishedContent> {
  if (localContentPreview) return parsePublishedContent(publishedContent());
  const { data, error } = await supabase.from('reader_books').select('content').eq('book_id', bookId).single();
  if (error) throw new Error('教材补充暂时无法载入。请检查网络后重试。', { cause: error });
  return parsePublishedContent(data.content);
}
