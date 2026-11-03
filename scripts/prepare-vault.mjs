import { lstat, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicFile, manifestHash, textbookId } from '../desktop/textbooks.ts';
import { parseManifest, readResource, verifyBytes, verifyDirectory } from './offline-resources.mjs';

// Explicit preparation only. Opening or scanning a vault never rewrites notes.
export async function prepareVault(vaultDirectory, resourceDirectory, pdfFile) {
  const vault = await realpath(vaultDirectory);
  const source = await realpath(resourceDirectory);
  const bytes = await readFile(new URL('../resources/offline/grade-7-volume-1/manifest.json', import.meta.url));
  const manifest = parseManifest(bytes, manifestHash);
  await verifyDirectory(source, manifest.download);
  let pdf;
  if (pdfFile) {
    const stat = await lstat(pdfFile);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('PDF 必须是普通文件。');
    pdf = await readFile(pdfFile);
    if (createHash('sha256').update(pdf).digest('hex') !== textbookId) throw new Error('PDF 与教材版本不匹配。');
  }
  const directory = `.textbook/textbooks/${textbookId}`;
  const resources = `${directory}/resources`;
  for (const entry of manifest.download) {
    const content = verifyBytes(entry, await readResource(source, entry.path));
    await atomicFile(vault, `${resources}/${entry.path}`, content, true);
  }
  if (pdf) await atomicFile(vault, `${directory}/source.pdf`, pdf, true);
  // The reader's editable catalog and import receipts already belong to the
  // vault. Do not replace them with the pristine resource catalog.
  try { await lstat(path.join(vault, directory, 'catalog.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await atomicFile(vault, `${directory}/catalog.json`, await readResource(source, 'textbooks/grade-7-volume-1/catalog.json'), true);
  }
  // Commit the pinned manifest last, after every resource has been verified.
  await atomicFile(vault, `${resources}/manifest.json`, bytes, true);
  return { vault, textbookId, files: manifest.download.length, pdf: !!pdf, resources: path.join(vault, resources) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [vault, resources, pdf] = process.argv.slice(2);
  if (!vault || !resources) throw new Error('用法：node --experimental-strip-types scripts/prepare-vault.mjs <笔记库> <已下载教材资源目录> [源PDF]');
  console.log(JSON.stringify(await prepareVault(vault, resources, pdf), null, 2));
}
