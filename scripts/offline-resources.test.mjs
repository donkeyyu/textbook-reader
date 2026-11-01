import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { artifactPath, bookPath, fetchResource, parseManifest, readResource, root, sha256, validateManifest, validatePath, verifyDirectory, verifyInstaller, verifyRepository } from './offline-resources.mjs';

const run = promisify(execFile);
const rejects = (promise, code) => assert.rejects(promise, { code });

test('committed manifest covers the current reviewed book and preserves directory IDs', async () => {
  const { manifest, bytes, hash } = await verifyRepository();
  assert.equal(sha256(bytes), hash);
  assert.equal(manifest.download.length, 405);
  assert.equal(manifest.source.baseUrl, null);
  const catalog = JSON.parse(await readFile(join(root, artifactPath, 'catalog.json'), 'utf8'));
  assert.equal(catalog.pages.length, 202);
  assert.equal(catalog.pages.filter((page) => page.printedPage === null).length, 16);
  assert.equal(catalog.pages[7].printedPage, null); // Chapter opening has no visible printed page.
  assert.equal(catalog.pages[8].printedPage, '2');
  assert.equal(catalog.chapters[0].id, 'chapter-1');
  assert.equal(catalog.sections[0].id, '1.1');
  assert.equal(catalog.contents.length, 46);
});

test('manifest trust, coverage and resource paths fail closed', async () => {
  const { manifest, bytes, hash } = await verifyRepository();
  assert.deepEqual(parseManifest(bytes, hash), manifest);
  assert.throws(() => parseManifest(Buffer.concat([bytes, Buffer.from(' ')]), hash), { code: 'MANIFEST_HASH_MISMATCH' });
  assert.throws(() => parseManifest(bytes), { code: 'MANIFEST_HASH_MISMATCH' });
  const invalid = Buffer.from('{bad');
  assert.throws(() => parseManifest(invalid, sha256(invalid)), { code: 'INVALID_MANIFEST' });
  for (const mutate of [
    (value) => { value.schemaVersion = 2; },
    (value) => { value.textbook.id = 'another-version'; },
    (value) => { value.download.push(value.download[0]); },
    (value) => { value.download[0].bytes = -1; },
    (value) => { value.download[0].sha256 = 'bad'; },
  ]) {
    const value = structuredClone(manifest);
    mutate(value);
    assert.throws(() => validateManifest(value), { code: 'INVALID_MANIFEST' });
  }
  const missingPage = structuredClone(manifest);
  missingPage.download.splice(20, 1);
  assert.throws(() => validateManifest(missingPage), { code: 'INCOMPLETE_MANIFEST' });
  const missingFont = structuredClone(manifest);
  missingFont.installerPublic = missingFont.installerPublic.filter((entry) => !entry.path.endsWith('.woff2'));
  assert.throws(() => validateManifest(missingFont), { code: 'INCOMPLETE_MANIFEST' });
  for (const path of ['../outside', '/absolute', 'C:/escape', 'a\\b', 'a//b', 'a/./b', 'a/../b', 'a/%2e%2e/b', 'a?x', 'a#x', 'a:b', 'CON', 'a/aux.txt', 'a/COM1.json', 'a.', '']) {
    assert.throws(() => validatePath(path), { code: 'INVALID_PATH' });
  }
});

test('local verification rejects missing, corrupt, oversized and symlinked files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offline-files-'));
  try {
    const data = Buffer.from('valid resource');
    const entry = { path: 'resource.bin', bytes: data.length, sha256: sha256(data) };
    await rejects(verifyDirectory(directory, [entry]), 'MISSING_RESOURCE');
    await writeFile(join(directory, entry.path), data);
    await verifyDirectory(directory, [entry]);
    await writeFile(join(directory, entry.path), Buffer.alloc(data.length));
    await rejects(verifyDirectory(directory, [entry]), 'HASH_MISMATCH');
    await writeFile(join(directory, entry.path), Buffer.concat([data, data]));
    await rejects(verifyDirectory(directory, [entry]), 'SIZE_MISMATCH');
    await symlink(join(directory, entry.path), join(directory, 'link.bin'));
    await rejects(readResource(directory, 'link.bin'), 'INVALID_PATH');
    await symlink(tmpdir(), join(directory, 'escape'), 'junction');
    await rejects(readResource(directory, 'escape/resource.bin'), 'INVALID_PATH');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('installer verification covers lazy chunks and requires bundled fonts', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'offline-installer-'));
  const directory = join(temporary, 'dist');
  const output = join(temporary, 'installer.json');
  try {
    const { manifest } = await verifyRepository();
    for (const entry of manifest.installerPublic) {
      const destination = join(directory, entry.path);
      await mkdir(join(destination, '..'), { recursive: true });
      await writeFile(destination, await readResource(join(root, 'public'), entry.path));
    }
    await mkdir(join(directory, 'assets'), { recursive: true });
    await writeFile(join(directory, 'index.html'), '<script src="assets/app.js"></script>');
    await writeFile(join(directory, 'assets/app.js'), 'import("./math.js")');
    await writeFile(join(directory, 'assets/math.js'), 'export const svgFont = "local";');
    await run(process.execPath, [join(root, 'scripts/offline-resources.mjs'), 'installer', directory, output]);
    const bytes = await readFile(output);
    const hash = sha256(bytes);
    const installer = await verifyInstaller(directory, bytes, hash);
    const font = manifest.installerPublic.find((entry) => entry.path.endsWith('.woff2'));
    await rm(join(directory, font.path));
    await rejects(verifyInstaller(directory, bytes, hash), 'MISSING_RESOURCE');
    await writeFile(join(directory, font.path), await readResource(join(root, 'public'), font.path));
    const omittedChunk = Buffer.from(JSON.stringify({ ...installer, resources: installer.resources.filter((entry) => entry.path !== 'assets/math.js') }));
    await rejects(verifyInstaller(directory, omittedChunk, sha256(omittedChunk)), 'INCOMPLETE_INSTALLER');
    await writeFile(join(directory, 'assets/math.js'), 'broken');
    await rejects(verifyInstaller(directory, bytes, hash), 'SIZE_MISMATCH');
    await rm(join(directory, 'assets/math.js'));
    await rejects(verifyInstaller(directory, bytes, hash), 'MISSING_RESOURCE');
    await rejects(run(process.execPath, [join(root, 'scripts/offline-resources.mjs'), 'installer', directory, join(directory, 'manifest.json')]), 1);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('real loopback HTTP transfers all staged resources and rejects damaged responses', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'offline-http-'));
  const directory = join(temporary, 'release');
  let server;
  try {
    await run(process.execPath, [join(root, 'scripts/offline-resources.mjs'), 'stage', directory], { cwd: root });
    const { manifest, hash } = await verifyRepository();
    const stagedManifest = await readFile(join(directory, 'manifest.json'));
    assert.equal(parseManifest(stagedManifest, hash).download.length, 405);
    await verifyDirectory(directory, manifest.download);
    server = createServer(async (request, response) => {
      try {
        const [, mode, ...parts] = new URL(request.url, 'http://localhost').pathname.split('/');
        const path = parts.join('/');
        if (mode === 'redirect') { response.writeHead(302, { Location: `/ok/${path}` }); response.end(); return; }
        if (mode === 'missing') { response.writeHead(404); response.end(); return; }
        if (mode === 'timeout') return;
        const data = await readResource(directory, path);
        if (mode === 'corrupt') data[0] ^= 1;
        if (mode === 'interrupted') { response.writeHead(200, { 'Content-Length': data.length }); response.write(data.subarray(0, 16)); response.destroy(); return; }
        response.writeHead(mode === 'partial' ? 206 : 200, { 'Content-Type': 'application/octet-stream' });
        if (mode === 'short') response.end(data.subarray(0, data.length - 1));
        else if (mode === 'long') response.end(Buffer.concat([data, Buffer.from('x')]));
        else response.end(data);
      } catch { response.writeHead(500); response.end(); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/`;
    const options = { allowLocalHttp: true };
    for (const entry of manifest.download) await fetchResource(`${base}ok/`, entry, options);
    const sample = manifest.download.find((entry) => entry.path === `${bookPath}/page-1.webp`);
    for (const [mode, code] of [['corrupt', 'HASH_MISMATCH'], ['short', 'SIZE_MISMATCH'], ['long', 'SIZE_MISMATCH'], ['missing', 'HTTP_ERROR'], ['partial', 'HTTP_ERROR'], ['redirect', 'NETWORK_ERROR'], ['interrupted', 'NETWORK_ERROR']]) {
      await rejects(fetchResource(`${base}${mode}/`, sample, options), code);
    }
    await rejects(fetchResource(`${base}timeout/`, sample, { ...options, timeoutMs: 30 }), 'NETWORK_ERROR');
    await rejects(fetchResource(`${base}ok/`, sample), 'INVALID_SOURCE');
    for (const url of ['file:///tmp/', 'http://example.com/', 'https://user:secret@example.com/', 'https://example.com/?token=x', 'https://example.com/root', 'invalid']) {
      await rejects(fetchResource(url, sample, options), 'INVALID_SOURCE');
    }
    const existing = join(temporary, 'not-empty');
    await mkdir(existing);
    await writeFile(join(existing, 'notes.md'), 'keep this note');
    await assert.rejects(run(process.execPath, [join(root, 'scripts/offline-resources.mjs'), 'stage', existing]), /OUTPUT_NOT_EMPTY/);
    assert.equal(await readFile(join(existing, 'notes.md'), 'utf8'), 'keep this note');
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await rm(temporary, { recursive: true, force: true });
  }
});
