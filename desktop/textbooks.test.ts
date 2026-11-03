import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, link, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { textbookStorage } from '../src/desktop/textbook-storage.ts';
import { loadShelf, saveShelf } from '../src/app/shelf/shelf-store.ts';
import { loadReadingPosition, saveReadingPosition } from '../src/reader/book/reading-record.ts';
import { loadStartupDestination, saveStartupDestination } from '../src/app/startup.ts';
import { TextbookStore, textbookId, manifestHash } from './textbooks.ts';

const project = path.resolve(import.meta.dirname, '..');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(path.join(project, 'resources/offline/grade-7-volume-1/manifest.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8')) as { download: { path: string; bytes: number; sha256: string }[]; installerPublic: { path: string; bytes: number; sha256: string }[] };
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'textbook-download-')));
  const app = path.join(root, 'app'); const data = path.join(root, 'data'); const vault = path.join(root, 'vault');
  await mkdir(path.join(app, 'resources/offline/grade-7-volume-1'), { recursive: true });
  await mkdir(path.join(app, 'dist/assets'), { recursive: true }); await mkdir(vault);
  await writeFile(path.join(app, 'resources/offline/grade-7-volume-1/manifest.json'), manifestBytes);
  const resources = [...manifest.installerPublic];
  for (const entry of resources) {
    await mkdir(path.dirname(path.join(app, 'dist', entry.path)), { recursive: true });
    await copyFile(path.join(project, 'public', entry.path), path.join(app, 'dist', entry.path));
  }
  for (const name of ['index.html', 'assets/test.js']) {
    const bytes = Buffer.from('test fixture'); await writeFile(path.join(app, 'dist', name), bytes);
    resources.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
  }
  resources.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, textbookManifestSha256: manifestHash, resources }));
  await writeFile(path.join(app, 'resources/offline/installer.json'), bytes);
  await writeFile(path.join(app, 'resources/offline/installer.json.sha256'), hash(bytes));
  return { root, app, data, vault };
}
const resource = (name: string) => readFile(path.join(project, name.endsWith('/catalog.json') ? 'resources/offline/grade-7-volume-1/catalog.json' : `public/${name}`));

test('HTTP download retries checked files, survives restart, repairs loss and preserves personal data', async () => {
  const f = await fixture();
  let failure: 'short' | 'hash' | 'missing' | null = 'short';
  const failedPath = manifest.download[4]!.path; const hits = new Map<string, number>();
  const server = createServer((request, response) => { void (async () => {
    const name = request.url!.slice(1); hits.set(name, (hits.get(name) ?? 0) + 1);
    const bytes = await resource(name);
    if (name === failedPath && failure) {
      if (failure === 'missing') { response.writeHead(404); response.end(); return; }
      const bad = failure === 'short' ? bytes.subarray(0, 10) : Buffer.alloc(bytes.length);
      response.end(bad); return;
    }
    if (name === failedPath) await new Promise((resolve) => setTimeout(resolve, 60));
    response.end(bytes);
  })().catch(() => { response.writeHead(404); response.end(); }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const source = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  try {
    const store = new TextbookStore(f.app, f.data, source, true); await store.initialize();
    assert.equal(store.snapshot().phase, 'unavailable');
    await assert.rejects(store.addToVault(f.vault, 'wrong-version'), /版本/);
    for (const mode of ['short', 'hash', 'missing'] as const) {
      failure = mode; await assert.rejects(store.addToVault(f.vault, textbookId), /未完成/);
      assert.equal(store.snapshot().phase, 'error'); assert.equal(store.snapshot().completed, 4);
      await assert.rejects(readFile(path.join(store.root, 'complete.json')));
    }
    assert.equal(hits.get(manifest.download[0]!.path), 1);
    await writeFile(path.join(f.vault, '个人.md'), '自定义笔记保持原样');
    await mkdir(path.join(f.vault, '.textbook/textbooks', textbookId), { recursive: true });
    const custom = path.join(f.vault, '.textbook/textbooks', textbookId, 'custom.json');
    await writeFile(custom, '{"future":true}'); failure = null;
    let selected = 'A';
    const pending = store.addToVault(f.vault, textbookId, () => { if (selected !== 'A') throw new Error('笔记库已切换'); });
    assert.equal(store.snapshot().phase, 'downloading'); selected = 'B';
    await assert.rejects(pending, /笔记库已切换/);
    await assert.rejects(readFile(path.join(f.vault, '.textbook/textbooks', textbookId, 'catalog.json')));
    const other = path.join(f.root, 'other-vault'); await mkdir(other);
    await assert.rejects(store.catalog(other)); assert.deepEqual(await readdir(other), []);
    const otherAdded = await store.addToVault(other, textbookId);
    assert.equal((await store.catalog(other) as { textbookId: string }).textbookId, textbookId);
    assert.ok(await readFile(path.join(other, otherAdded.catalogPath)));
    const added = await store.addToVault(f.vault, textbookId); assert.equal(added.textbookId, textbookId);
    assert.equal(store.snapshot().phase, 'ready'); assert.equal(store.snapshot().completed, 405);
    const catalog = await store.catalog() as { pages: { page: number; printedPage: string | null }[]; contents: unknown[] };
    assert.equal(catalog.pages.length, 202); assert.equal(catalog.contents.length, 46);
    assert.equal(catalog.pages[0]!.printedPage, null);
    assert.equal(await readFile(custom, 'utf8'), '{"future":true}');
    assert.equal(await readFile(path.join(f.vault, '个人.md'), 'utf8'), '自定义笔记保持原样');
    const before = new Map(hits);
    const offline = new TextbookStore(f.app, f.data, null);
    const read = fs.promises.readFile; let startupResourceReads = 0;
    fs.promises.readFile = (async (...args: Parameters<typeof read>) => {
      if (String(args[0]).startsWith(`${store.root}${path.sep}textbooks${path.sep}`)) startupResourceReads++;
      return read(...args);
    }) as typeof read;
    syncBuiltinESMExports();
    try { await offline.initialize(); }
    finally { fs.promises.readFile = read; syncBuiltinESMExports(); }
    assert.equal(startupResourceReads, 0, 'Warm startup must not reread 405 unchanged resources');
    assert.equal(offline.snapshot().phase, 'ready'); await offline.addToVault(f.vault, textbookId);
    for (const entry of manifest.download) assert.equal(hash(await offline.read(entry.path)), entry.sha256);
    assert.deepEqual(hits, before);
    const verification = path.join(f.data, 'textbook-verification');
    assert.ok((await readdir(verification)).length >= 2, 'Warm startup retains rebuildable validation receipts outside the vault');
    // A copied repository must open without any shared appData textbook files.
    const portable = path.join(f.vault, '.textbook/textbooks', textbookId, 'resources');
    await cp(store.root, portable, { recursive: true });
    await writeFile(path.join(portable, 'manifest.json'), manifestBytes);
    const defaultRoot = store.root;
    await rm(path.join(defaultRoot, failedPath));
    const downloading = store.download();
    await store.useVaultResources(f.vault);
    await downloading;
    assert.equal(store.root, portable, 'An old download must not switch the selected vault back');
    assert.equal(store.snapshot().phase, 'ready');
    assert.equal(hash(await readFile(path.join(defaultRoot, failedPath))), manifest.download.find((entry) => entry.path === failedPath)!.sha256,
      'An in-flight download finishes in its original directory');
    await store.useVaultResources(other);
    const detached = new TextbookStore(f.app, path.join(f.root, 'fresh-device'), null);
    await detached.initialize();
    assert.equal(detached.snapshot().phase, 'unavailable');
    await detached.useVaultResources(f.vault);
    assert.equal(detached.root, portable);
    assert.equal(detached.snapshot().phase, 'ready');
    assert.equal(hash(await detached.read(manifest.download[0]!.path)), manifest.download[0]!.sha256);
    await detached.useVaultResources(other);
    assert.equal(detached.snapshot().phase, 'unavailable', 'A plain vault cannot use the previous vault resources');
    await detached.useVaultResources(f.vault);
    const originalManifest = await readFile(path.join(portable, 'manifest.json'));
    await rm(path.join(portable, 'manifest.json'));
    await detached.useVaultResources(f.vault);
    assert.equal(detached.snapshot().phase, 'unavailable', 'An incomplete portable resource folder cannot silently fall back');
    await writeFile(path.join(portable, 'manifest.json'), originalManifest);
    await detached.useVaultResources(f.vault);
    assert.equal(detached.snapshot().phase, 'ready');
    // Restoring mtime cannot hide same-sized corruption: ctime is part of the receipt.
    const portablePage = path.join(portable, manifest.download[0]!.path);
    const originalPage = await readFile(portablePage); const originalStat = await stat(portablePage);
    await writeFile(portablePage, Buffer.alloc(originalPage.length));
    await utimes(portablePage, originalStat.atime, originalStat.mtime);
    await detached.useVaultResources(f.vault);
    assert.equal(detached.snapshot().phase, 'unavailable');
    await writeFile(portablePage, originalPage);
    await detached.useVaultResources(f.vault);
    assert.equal(detached.snapshot().phase, 'ready');
    // Corrupt receipts are discarded; a real resource check rebuilds them.
    for (const name of await readdir(verification)) await writeFile(path.join(verification, name), '{broken');
    const uncached = new TextbookStore(f.app, f.data, null); await uncached.initialize();
    assert.equal(uncached.snapshot().phase, 'ready');
    await writeFile(path.join(f.app, 'dist/assets/unlisted.js'), 'unexpected');
    const changedInstaller = new TextbookStore(f.app, f.data, null); await changedInstaller.initialize();
    assert.equal(changedInstaller.snapshot().phase, 'unavailable');
    await rm(path.join(f.app, 'dist/assets/unlisted.js'));
    const damaged = manifest.download[10]!;
    await writeFile(path.join(store.root, damaged.path), 'corrupt');
    const restart = new TextbookStore(f.app, f.data, source, true); await restart.initialize();
    assert.equal(restart.snapshot().phase, 'unavailable'); await assert.rejects(restart.read(damaged.path), /完整校验/);
    await restart.addToVault(f.vault, textbookId);
    assert.equal(hits.get(damaged.path), (before.get(damaged.path) ?? 0) + 1);
    // Hidden metadata gets the same boundary checks as visible Markdown files.
    const outside = path.join(f.root, 'outside'); await mkdir(outside);
    const external = path.join(outside, 'target.json'); await writeFile(external, 'external original bytes');
    for (const boundary of ['.textbook', '.textbook/textbooks', `.textbook/textbooks/${textbookId}`]) {
      const unsafe = path.join(f.root, `unsafe-${boundary.split('/').length}`); await mkdir(unsafe);
      await mkdir(path.dirname(path.join(unsafe, boundary)), { recursive: true });
      await symlink(outside, path.join(unsafe, boundary), 'dir');
      await assert.rejects(offline.addToVault(unsafe, textbookId), /符号链接|目录联接/);
      await assert.rejects(offline.catalog(unsafe));
      assert.equal(await readFile(external, 'utf8'), 'external original bytes');
    }
    for (const kind of ['symbolic', 'hard']) {
      const unsafe = path.join(f.root, `unsafe-${kind}`);
      const target = path.join(unsafe, added.catalogPath); await mkdir(path.dirname(target), { recursive: true });
      if (kind === 'symbolic') await symlink(external, target); else await link(external, target);
      await assert.rejects(offline.addToVault(unsafe, textbookId), /普通文件/);
      await assert.rejects(offline.catalog(unsafe));
      assert.equal(await readFile(external, 'utf8'), 'external original bytes');
    }
    await writeFile(path.join(f.vault, added.catalogPath), '{"unknown":"keep"}');
    await assert.rejects(restart.addToVault(f.vault, textbookId), /已有不同内容/);
    assert.equal(await readFile(path.join(f.vault, added.catalogPath), 'utf8'), '{"unknown":"keep"}');
    await rm(path.join(restart.root, damaged.path));
    assert.equal(restart.snapshot().phase, 'ready'); await assert.rejects(restart.read(damaged.path));
    assert.equal(restart.snapshot().phase, 'error');
    await symlink(path.join(f.vault, '个人.md'), path.join(restart.root, damaged.path));
    await assert.rejects(restart.addToVault(f.vault, textbookId));
    assert.equal(await readFile(path.join(f.vault, '个人.md'), 'utf8'), '自定义笔记保持原样');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(f.root, { recursive: true, force: true }); }
});

test('missing source, untrusted transport and incomplete installer cannot report ready', async () => {
  const f = await fixture();
  try {
    const store = new TextbookStore(f.app, f.data, null); await store.initialize();
    await assert.rejects(store.addToVault(f.vault, textbookId), /尚未配置/);
    assert.equal(store.snapshot().phase, 'error');
    const alias = path.join(f.root, 'data-alias'); await symlink(f.data, alias, 'dir');
    const aliased = new TextbookStore(f.app, alias, null); await aliased.initialize();
    assert.equal(aliased.root, store.root);
    const insecure = new TextbookStore(f.app, f.data, 'http://example.com/'); await insecure.initialize();
    await assert.rejects(insecure.addToVault(f.vault, textbookId), /INVALID_SOURCE/);
    await rm(path.join(f.app, 'dist/assets/test.js'));
    const broken = new TextbookStore(f.app, f.data, null); await broken.initialize();
    await assert.rejects(broken.download(), /安装资源校验失败/);
    assert.equal(broken.snapshot().phase, 'unavailable');
    await mkdir(f.data, { recursive: true });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('vaults have independent members, startup destination and reading records', () => {
  const values = new Map<string, string>();
  const local = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const a = textbookStorage('vault-a', local); const b = textbookStorage('vault-b', local);
  saveShelf([textbookId], a); saveReadingPosition({ page: 88, fraction: 0.3 }, a);
  saveStartupDestination({ page: 'reader', bookId: textbookId }, a);
  assert.deepEqual(loadShelf(b), []); assert.equal(loadReadingPosition(b), null); assert.equal(loadStartupDestination(b), null);
  saveShelf([textbookId], b); saveReadingPosition({ page: 12, fraction: 0.1 }, b);
  saveShelf([], a);
  assert.deepEqual(loadShelf(b), [textbookId]); assert.equal(loadReadingPosition(a)?.page, 88); assert.equal(loadReadingPosition(b)?.page, 12);
  assert.equal(local.getItem('textbook-shelf-v1'), null);
});
