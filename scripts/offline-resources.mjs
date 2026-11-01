import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const textbookId = '6f2a471b07f44a4985756affed9c3c58da7232d205317b1f643b1a865e4e7249';
export const pageCount = 202;
export const bookPath = 'textbooks/grade-7-volume-1';
export const artifactPath = 'resources/offline/grade-7-volume-1';
const indexPath = 'materials/indexes/人教版-数学-七年级上册';
const sourcePath = 'materials/textbooks/人教版-数学-七年级上册.source.json';
const fontPaths = ['noto-serif-sc-display.woff2', ...[400, 500, 600, 700, 800].map((weight) => `nunito-latin-${weight}-normal.woff2`), 'noto-serif-sc-OFL.txt', 'nunito-OFL.txt'].map((path) => `fonts/${path}`);
const downloadPaths = [...Array.from({ length: pageCount }, (_, index) => [`${bookPath}/page-${index + 1}.webp`, `${bookPath}/thumb-${index + 1}.webp`]).flat(), `${bookPath}/catalog.json`];
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const json = (data) => `${JSON.stringify(data, null, 2)}\n`;
const fail = (code, message, path) => { throw Object.assign(new Error(message), { code, path }); };
const check = (condition, code, message, path) => { if (!condition) fail(code, message, path); };
const isHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function validatePath(path) {
  check(typeof path === 'string' && path.split('/').every((part) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part) &&
    !part.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) && path.length < 240,
    'INVALID_PATH', 'Expected a plain relative POSIX resource path.', path);
  return path;
}

function validateEntries(entries) {
  check(Array.isArray(entries), 'INVALID_MANIFEST', 'Expected a resource list.');
  const seen = new Set();
  for (const entry of entries) {
    check(entry && typeof entry === 'object', 'INVALID_MANIFEST', 'Invalid resource entry.');
    validatePath(entry.path);
    check(!seen.has(entry.path.toLowerCase()), 'INVALID_MANIFEST', 'Duplicate resource path.', entry.path);
    seen.add(entry.path.toLowerCase());
    check(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= 64 * 1024 * 1024 && isHash(entry.sha256),
      'INVALID_MANIFEST', 'Invalid resource size or SHA-256.', entry.path);
  }
}

export function validateManifest(manifest) {
  check(manifest?.schemaVersion === 1 && manifest.textbook?.id === textbookId && manifest.textbook?.pageCount === pageCount,
    'INVALID_MANIFEST', 'Unsupported schema or textbook version.');
  check(manifest.source?.status === 'unpublished' && manifest.source.baseUrl === null,
    'INVALID_MANIFEST', 'This preparation manifest has no published download source.');
  validateEntries(manifest.download);
  validateEntries(manifest.installerPublic);
  const paths = new Set(manifest.download.map((entry) => entry.path));
  check(paths.size === downloadPaths.length && downloadPaths.every((path) => paths.has(path)),
    'INCOMPLETE_MANIFEST', 'The manifest must include all 202 pages, thumbnails and the catalog.');
  check(fontPaths.every((path) => manifest.installerPublic.some((entry) => entry.path === path)) &&
    manifest.installerPublic.every((entry) => !entry.path.startsWith('textbooks/')),
  'INCOMPLETE_MANIFEST', 'Installer fonts and licenses are required.');
  return manifest;
}

// The expected digest must come from the trusted app/release, never just the same HTTP server.
function parsePinnedJson(bytes, expectedSha256) {
  check(isHash(expectedSha256) && sha256(bytes) === expectedSha256, 'MANIFEST_HASH_MISMATCH', 'Manifest SHA-256 does not match the trusted digest.');
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { fail('INVALID_MANIFEST', 'Manifest is not valid JSON.'); }
}

export function parseManifest(bytes, expectedSha256) {
  return validateManifest(parsePinnedJson(bytes, expectedSha256));
}

export function verifyBytes(entry, bytes) {
  check(bytes.length === entry.bytes, 'SIZE_MISMATCH', 'Resource byte count does not match.', entry.path);
  check(sha256(bytes) === entry.sha256, 'HASH_MISMATCH', 'Resource SHA-256 does not match.', entry.path);
  return bytes;
}

export async function readResource(directory, path) {
  validatePath(path);
  let file = await realpath(directory);
  for (const part of path.split('/')) {
    file = join(file, part);
    let stat;
    try { stat = await lstat(file); }
    catch (error) { if (error.code === 'ENOENT') fail('MISSING_RESOURCE', 'Resource is missing.', path); throw error; }
    check(!stat.isSymbolicLink(), 'INVALID_PATH', 'Resource symlinks are not allowed.', path);
  }
  check((await lstat(file)).isFile(), 'INVALID_PATH', 'Resource is not a regular file.', path);
  return readFile(file);
}

async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    validatePath(path);
    check(!entry.isSymbolicLink(), 'INVALID_PATH', 'Resource symlinks are not allowed.', path);
    if (entry.isDirectory()) result.push(...await files(directory, path));
    else { check(entry.isFile(), 'INVALID_PATH', 'Resource is not a regular file.', path); result.push(path); }
  }
  return result.sort();
}

const describe = (path, bytes) => ({ path, bytes: bytes.length, sha256: sha256(bytes) });
const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));

async function snapshot() {
  const source = await readJson(sourcePath);
  const book = await readJson('src/textbook/book.json');
  const prepared = await readJson(`public/${bookPath}/source.json`);
  const index = await readJson(`${indexPath}/manifest.json`);
  const verification = await readJson(`${indexPath}/verification.json`);
  check(source.sha256 === textbookId && source.pdf_page_count === pageCount && book.documentSha256 === textbookId &&
    book.pageCount === pageCount && book.pages.length === pageCount && prepared.documentSha256 === textbookId &&
    JSON.stringify(prepared.pages) === JSON.stringify(book.pages) && index.document_sha256 === textbookId && index.pages.length === pageCount &&
    verification.document_sha256 === textbookId && verification.all_pages_reviewed,
  'SOURCE_MISMATCH', 'Expected the current reviewed 202-page textbook.');
  verifyBytes({ path: source.local_file, bytes: source.bytes, sha256: textbookId }, await readFile(join(root, 'materials/textbooks', source.local_file)));
  for (const [path, hash] of Object.entries(verification.checked_files_sha256)) {
    validatePath(path);
    const bytes = await readFile(join(root, indexPath, path));
    // The reviewed CSV digest used CRLF; Git stores that same CSV with LF.
    const originalCsv = path === 'page-map.csv' ? bytes.toString('utf8').replaceAll('\r\n', '\n').replaceAll('\n', '\r\n') : bytes;
    check(sha256(bytes) === hash || sha256(originalCsv) === hash, 'SOURCE_MISMATCH', 'Reviewed index has changed.', path);
  }
  const pageMap = (await readFile(join(root, indexPath, 'index.jsonl'), 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  check(pageMap.length === pageCount, 'SOURCE_MISMATCH', 'Incomplete reviewed page map.');
  const download = [];
  for (const [offset, page] of book.pages.entries()) {
    const reviewed = pageMap[offset];
    check(page.page === offset + 1 && page.width > 0 && page.height > 0 && reviewed.physical_page === page.page &&
      reviewed.document_sha256 === textbookId && reviewed.review_state === 'reviewed' && reviewed.printed_page === page.printedPage &&
      (reviewed.printed_page_state === 'absent' && page.printedPage === null || reviewed.printed_page_state === 'verified' && typeof page.printedPage === 'string') &&
      index.pages[offset].physical_page === page.page && reviewed.page_image_sha256 === index.pages[offset].image_sha256,
    'SOURCE_MISMATCH', 'Page identity or reviewed printed page does not match.', String(page.page));
    for (const kind of ['page', 'thumb']) {
      const path = `${bookPath}/${kind}-${page.page}.webp`;
      const bytes = await readResource(join(root, 'public'), path);
      const record = await readJson(`public/${path}.json`);
      check(record.documentSha256 === textbookId && record.physicalPage === page.page &&
        record.sourceImageSha256 === reviewed.page_image_sha256 && record.sourceWidth === page.width && record.sourceHeight === page.height &&
        record.outputSha256 === sha256(bytes) && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
      'SOURCE_MISMATCH', 'Prepared image does not match its checked source record.', path);
      download.push(describe(path, bytes));
    }
  }
  // Load the existing exported IDs and ranges; do not invent a second directory.
  const sectionModule = pathToFileURL(join(root, 'src/textbook/sections.ts')).href;
  const loaded = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    `import { chapters, sections } from ${JSON.stringify(sectionModule)}; process.stdout.write(JSON.stringify({ chapters, sections }));`], { encoding: 'utf8' });
  check(loaded.status === 0, 'SOURCE_MISMATCH', `Cannot load existing chapter/section IDs: ${loaded.stderr}`);
  const { chapters, sections } = JSON.parse(loaded.stdout);
  const catalogText = await readFile(join(root, indexPath, 'catalog.md'), 'utf8');
  const contents = [...catalogText.matchAll(/^\| (.+) \| (\d+) \| (\d+) \|$/gm)].map(([, title, printedPage, pdfPage]) => ({ title, contentsPrintedPage: printedPage, pdfPage: Number(pdfPage) }));
  check(chapters.length === 6 && sections.length === 15 && contents.length === 46, 'SOURCE_MISMATCH', 'Existing directory coverage has changed; review before regenerating.');
  const catalog = { schemaVersion: 1, textbookId, title: book.title, pageCount, pages: book.pages, chapters, sections, contents };
  const catalogBytes = Buffer.from(json(catalog));
  download.push(describe(`${bookPath}/catalog.json`, catalogBytes));
  const installerPublic = [];
  for (const path of (await files(join(root, 'public'))).filter((path) => !path.startsWith('textbooks/'))) {
    installerPublic.push(describe(path, await readResource(join(root, 'public'), path)));
  }
  const manifest = validateManifest({ schemaVersion: 1, textbook: { id: textbookId, title: book.title, pageCount },
    source: { status: 'unpublished', baseUrl: null, record: sourcePath, originalPdfUrl: source.resource_url, pageUrl: source.page_url,
      note: 'Original PDF provenance only. Prepared WebP/catalog files have no published download base URL.' },
    download, installerPublic });
  return { catalogBytes, manifestBytes: Buffer.from(json(manifest)) };
}

export async function loadManifest() {
  const bytes = await readFile(join(root, artifactPath, 'manifest.json'));
  const hash = (await readFile(join(root, artifactPath, 'manifest.sha256'), 'utf8')).trim();
  return { manifest: parseManifest(bytes, hash), bytes, hash };
}

export async function verifyRepository() {
  const expected = await snapshot();
  const current = await loadManifest();
  check(expected.manifestBytes.equals(current.bytes) && expected.catalogBytes.equals(await readFile(join(root, artifactPath, 'catalog.json'))),
    'STALE_MANIFEST', 'Committed artifacts differ from current source; review and regenerate.');
  return current;
}

export async function verifyDirectory(directory, entries) {
  validateEntries(entries);
  for (const entry of entries) verifyBytes(entry, await readResource(directory, entry.path));
}

export async function fetchResource(baseUrl, entry, { allowLocalHttp = false, timeoutMs = 30_000 } = {}) {
  validateEntries([entry]);
  let base;
  try { base = new URL(baseUrl); }
  catch { fail('INVALID_SOURCE', 'Download source is not a valid URL.'); }
  check(!base.username && !base.password && !base.search && !base.hash && base.pathname.endsWith('/') &&
    (base.protocol === 'https:' || allowLocalHttp && base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)),
  'INVALID_SOURCE', 'Use an HTTPS directory URL, or explicitly allow loopback HTTP for tests.');
  try {
    const response = await fetch(new URL(entry.path, base), { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      fail('HTTP_ERROR', `HTTP ${response.status}; expected 200.`, entry.path);
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      check(length <= entry.bytes, 'SIZE_MISMATCH', 'Download is larger than the manifest size.', entry.path);
      chunks.push(chunk);
    }
    return verifyBytes(entry, Buffer.concat(chunks));
  } catch (error) {
    if (['HTTP_ERROR', 'SIZE_MISMATCH', 'HASH_MISMATCH'].includes(error.code)) throw error;
    fail('NETWORK_ERROR', `Download failed: ${error.message}`, entry.path);
  }
}

async function installerEntries(directory, manifest) {
  const paths = (await files(directory)).filter((path) => !path.startsWith('textbooks/'));
  check(paths.includes('index.html') && paths.some((path) => /^assets\/.+\.js$/.test(path)), 'INCOMPLETE_INSTALLER', 'Build entry point and JS chunks are required.');
  await verifyDirectory(directory, manifest.installerPublic);
  const entries = [];
  for (const path of paths) entries.push(describe(path, await readResource(directory, path)));
  return entries;
}

export async function verifyInstaller(directory, bytes, expectedSha256) {
  const installer = parsePinnedJson(bytes, expectedSha256);
  const { manifest, hash } = await loadManifest();
  check(installer?.schemaVersion === 1 && installer.textbookManifestSha256 === hash, 'INVALID_MANIFEST', 'Installer must reference the trusted textbook manifest.');
  await verifyDirectory(directory, installer.resources);
  const current = await installerEntries(directory, manifest);
  check(JSON.stringify(installer.resources) === JSON.stringify(current), 'INCOMPLETE_INSTALLER', 'Installer manifest must cover every built file except downloadable textbooks.');
  return installer;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'generate' && args.length === 0) {
    const { catalogBytes, manifestBytes } = await snapshot();
    await mkdir(join(root, artifactPath), { recursive: true });
    await writeFile(join(root, artifactPath, 'catalog.json'), catalogBytes);
    await writeFile(join(root, artifactPath, 'manifest.json'), manifestBytes);
    await writeFile(join(root, artifactPath, 'manifest.sha256'), `${sha256(manifestBytes)}\n`);
    console.log(`Generated ${artifactPath}; SHA-256 ${sha256(manifestBytes)}`);
  } else if (command === 'verify' && args.length === 0) {
    const { hash } = await verifyRepository();
    console.log(`Verified 202 pages, 202 thumbnails, catalog and installer public files; manifest ${hash}`);
  } else if (command === 'stage' && args.length === 1) {
    const { manifest, bytes, hash } = await verifyRepository();
    const directory = resolve(args[0]);
    await mkdir(directory, { recursive: true });
    check((await readdir(directory)).length === 0, 'OUTPUT_NOT_EMPTY', 'Staging directory must be empty.');
    for (const entry of manifest.download) {
      const data = entry.path.endsWith('/catalog.json') ? await readFile(join(root, artifactPath, 'catalog.json')) : await readResource(join(root, 'public'), entry.path);
      verifyBytes(entry, data);
      await mkdir(dirname(join(directory, entry.path)), { recursive: true });
      await writeFile(join(directory, entry.path), data, { flag: 'wx' });
    }
    await writeFile(join(directory, 'manifest.json'), bytes, { flag: 'wx' });
    await writeFile(join(directory, 'manifest.sha256'), `${hash}\n`, { flag: 'wx' });
    await verifyDirectory(directory, manifest.download);
    console.log(`Staged and verified ${manifest.download.length} resources in ${directory}; not published.`);
  } else if (command === 'http-check' && args.length >= 1 && args.length <= 2 && (!args[1] || args[1] === '--allow-local-http')) {
    const { manifest } = await verifyRepository();
    for (const entry of manifest.download) await fetchResource(args[0], entry, { allowLocalHttp: args[1] === '--allow-local-http' });
    console.log(`HTTP verified all ${manifest.download.length} resources from ${args[0]}`);
  } else if (command === 'installer' && args.length === 2) {
    const { manifest, hash } = await verifyRepository();
    const directory = resolve(args[0]);
    const output = resolve(args[1]);
    const outputRelative = relative(directory, output);
    check(isAbsolute(outputRelative) || outputRelative === '..' || outputRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
      'INVALID_PATH', 'Write installer manifest outside the build directory.');
    const resources = await installerEntries(directory, manifest);
    const bytes = Buffer.from(json({ schemaVersion: 1, textbookManifestSha256: hash, resources }));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes);
    await writeFile(`${output}.sha256`, `${sha256(bytes)}\n`);
    console.log(`Recorded and verified ${resources.length} files from the supplied build; ${output}`);
  } else if (command === 'verify-installer' && args.length === 2) {
    const bytes = await readFile(args[1]);
    const hash = (await readFile(`${args[1]}.sha256`, 'utf8')).trim();
    const installer = await verifyInstaller(resolve(args[0]), bytes, hash);
    console.log(`Verified all ${installer.resources.length} installer resources against ${hash}`);
  } else {
    fail('USAGE', 'Usage: node scripts/offline-resources.mjs generate|verify|stage <empty-dir>|http-check <base-url> [--allow-local-http]|installer|verify-installer <dist> <manifest-file>');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`${error.code ?? 'IO_ERROR'}: ${error.message}${error.path ? ` (${error.path})` : ''}`); process.exitCode = 1; });
}
