import { supabase } from '../account/supabase.ts';
import { bookId, parsePublishedContent, type PublishedContent } from './content.ts';

export async function readPublishedContent(): Promise<PublishedContent> {
  const { data, error } = await supabase.from('reader_books').select('content').eq('book_id', bookId).single();
  if (error) throw new Error('教材补充暂时无法载入。请检查网络后重试。', { cause: error });
  return parsePublishedContent(data.content);
}
