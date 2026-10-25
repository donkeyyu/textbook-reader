import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const indexDirectory = join(root, "materials/indexes/人教版-数学-七年级上册");
const source = "materials/textbooks/人教版-数学-七年级上册.pdf";
const expectedSha256 = "6f2a471b07f44a4985756affed9c3c58da7232d205317b1f643b1a865e4e7249";
const pageCount = 202;
const bookTitle = "数学 · 七年级上册";
const digest = (data) => createHash("sha256").update(data).digest("hex");
const json = (data) => JSON.stringify(data, null, 2) + "\n";
const run = promisify(execFile);
const manifest = JSON.parse(await readFile(join(indexDirectory, "manifest.json"), "utf8"));
const pageMapSource = "materials/indexes/人教版-数学-七年级上册/index.jsonl";
const indexText = await readFile(join(root, pageMapSource), "utf8");
const verification = JSON.parse(await readFile(join(indexDirectory, "verification.json"), "utf8"));
const pageMap = indexText.trim().split(/\r?\n/).map((line) => JSON.parse(line));
if (digest(await readFile(join(root, source))) !== expectedSha256 ||
    manifest.document_sha256 !== expectedSha256 || manifest.page_count !== pageCount ||
    manifest.pages.length !== pageCount || pageMap.length !== pageCount ||
    verification.document_sha256 !== expectedSha256 || !verification.all_pages_reviewed ||
    digest(indexText) !== verification.checked_files_sha256["index.jsonl"]) {
  throw new Error("教材 PDF 或索引不匹配：需要已核对的 202 页七年级上册。");
}
const printedLabels = new Set();
for (const [index, entry] of pageMap.entries()) {
  if (entry.physical_page !== index + 1 || entry.document_sha256 !== expectedSha256 ||
      entry.review_state !== "reviewed" || entry.page_image_sha256 !== manifest.pages[index].image_sha256 ||
      !(entry.printed_page_state === "absent" && entry.printed_page === null ||
        entry.printed_page_state === "verified" && typeof entry.printed_page === "string" && entry.printed_page.trim())) {
    throw new Error(`印刷页码尚未核实或来源不符：文件第 ${index + 1} 页`);
  }
  if (entry.printed_page !== null) {
    if (printedLabels.has(entry.printed_page)) throw new Error(`重复印刷页码：${entry.printed_page}`);
    printedLabels.add(entry.printed_page);
  }
}

// Verify every source before converting or replacing the current book.
const pages = [];
for (const [index, entry] of manifest.pages.entries()) {
  const page = index + 1;
  if (entry.physical_page !== page || entry.image_path !== `images/page-${String(page).padStart(6, "0")}.png`) {
    throw new Error(`索引缺页或页序不符：${page}`);
  }
  const image = await readFile(join(indexDirectory, entry.image_path));
  if (digest(image) !== entry.image_sha256 ||
      !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      image.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`教材第 ${page} 页图像校验失败。`);
  }
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (!width || !height) throw new Error(`教材第 ${page} 页尺寸无效。`);
  pages.push({ page, width, height, printedPage: pageMap[index].printed_page });
}

const parent = join(root, "public/textbooks");
const output = join(parent, "grade-7-volume-1");
await mkdir(parent, { recursive: true });
const temporary = await mkdtemp(join(parent, ".prepare-"));
try {
  let next = 0;
  const workers = await Promise.allSettled(Array.from({ length: 4 }, async () => {
    while (next < pages.length) {
      const { page, width, height } = pages[next++];
      const entry = manifest.pages[page - 1];
      const origin = join(indexDirectory, entry.image_path);
      for (const kind of ["page", "thumb"]) {
        const file = `${kind}-${page}.webp`;
        const options = kind === "page" ? ["-q", "92"] : ["-resize", "160", "0", "-q", "75"];
        await run("cwebp", ["-quiet", ...options, origin, "-o", join(temporary, file)]);
        const image = await readFile(join(temporary, file));
        if (image.toString("ascii", 0, 4) !== "RIFF" || image.toString("ascii", 8, 12) !== "WEBP") {
          throw new Error(`输出图像校验失败：${file}`);
        }
        await writeFile(join(temporary, `${file}.json`), json({
          prompt: `Source: ${source}; physical PDF page ${page}; ${kind}; converted from verified index PNG with cwebp, not AI-generated.`,
          createdAt: new Date().toISOString(),
          source,
          documentSha256: expectedSha256,
          physicalPage: page,
          sourceImage: `materials/indexes/人教版-数学-七年级上册/${entry.image_path}`,
          sourceImageSha256: entry.image_sha256,
          outputSha256: digest(image),
          sourceWidth: width,
          sourceHeight: height,
          conversion: ["cwebp", ...options],
        }));
      }
    }
  }));
  const failed = workers.find((worker) => worker.status === "rejected");
  if (failed) throw failed.reason;
  const book = { title: bookTitle, documentSha256: expectedSha256, pageMapSource, pageCount, pages };
  await writeFile(join(temporary, "source.json"), json({
    ...book,
    source,
    sourceRecord: "materials/textbooks/人教版-数学-七年级上册.source.json",
    manifest: "materials/indexes/人教版-数学-七年级上册/manifest.json",
    convertedBy: "cwebp; reused verified PNG images without rendering the PDF again",
  }));
  await rm(output, { recursive: true, force: true });
  await rename(temporary, output);
  await writeFile(join(root, "src/textbook/book.json"), json(book));
  await rm(join(root, "public/textbook-sample"), { recursive: true, force: true });
  console.log(`已校验并准备 ${pages.length} 页及缩略图：${output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
