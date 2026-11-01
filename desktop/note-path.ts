// Shared by filesystem access and link resolution on both desktop platforms.
export function notePath(input: unknown): asserts input is string {
  if (typeof input !== 'string' || input.length > 1000 || !input.endsWith('.md') ||
    input.split('/').some((part) => !part || part.startsWith('.') || [...part].some((character) => character.charCodeAt(0) < 32) || /[\\:<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('请使用笔记库内的 Markdown 路径；不支持隐藏文件、特殊路径或系统保留名。');
  }
}
