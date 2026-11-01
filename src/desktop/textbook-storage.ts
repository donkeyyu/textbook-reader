// Members, startup destination and reading records belong to the selected vault.
// Downloaded resource bytes stay in the app's persistent resource directory.
export function textbookStorage(vaultKey: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {
  const prefix = `desktop-textbooks:${vaultKey}:`;
  return { getItem: (key: string) => storage.getItem(`${prefix}${key}`), setItem: (key: string, value: string) => storage.setItem(`${prefix}${key}`, value) };
}
