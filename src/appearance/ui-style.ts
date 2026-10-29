export const uiStyles = {
  island: { label: '小岛书桌', description: '奶油纸色，薄荷绿与圆润控件' },
  simple: { label: '简洁', description: '白灰底色，清晰克制' },
  warm: { label: '温暖书桌', description: '纸色与深绿，舒展阅读' },
  youth: { label: '轻活泼少年', description: '明快蓝色，轻盈几何' },
} as const;

export type UiStyle = keyof typeof uiStyles;
export const uiStyleStorageKey = 'textbook-ui-style-v1';
type StyleStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadUiStyle(storage?: StyleStorage): UiStyle {
  try {
    const value = (storage ?? localStorage).getItem(uiStyleStorageKey);
    return value !== null && Object.hasOwn(uiStyles, value) ? value as UiStyle : 'island';
  } catch (cause) {
    throw new Error('无法读取风格设置，暂用小岛书桌。你仍可选择风格。', { cause });
  }
}

export function saveUiStyle(style: UiStyle, storage?: StyleStorage): void {
  try { (storage ?? localStorage).setItem(uiStyleStorageKey, style); }
  catch (cause) { throw new Error('风格已应用，但无法保存。刷新后可能恢复原风格，请重试。', { cause }); }
}
