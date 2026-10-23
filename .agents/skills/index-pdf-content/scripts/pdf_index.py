#!/usr/bin/env python3
"""Prepare and check visual PDF indexes using only stdlib and Poppler."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


REVISION = "index-pdf-content/1"
CONTENT_TYPES = {"text", "formula", "table", "figure", "other"}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(*args):
    return subprocess.run(args, capture_output=True, env={**os.environ, "LC_ALL": "C"})


def page_count(pdf):
    result = run("pdfinfo", str(pdf))
    match = re.search(rb"^Pages:\s+([1-9][0-9]*)\s*$", result.stdout, re.MULTILINE)
    if result.returncode or match is None:
        raise ValueError("Cannot read PDF page count: " + result.stderr.decode(errors="replace"))
    return int(match[1])


def select_pages(spec, count):
    if spec == "all":
        return list(range(1, count + 1))
    pages = []
    for part in spec.split(","):
        match = re.fullmatch(r"([1-9][0-9]*)(?:-([1-9][0-9]*))?", part.strip())
        if match is None:
            raise ValueError("Use PDF page numbers such as 1-3,5 or all")
        first, last = int(match[1]), int(match[2] or match[1])
        if not 1 <= first <= last <= count:
            raise ValueError(f"Page range is outside 1-{count}: {part}")
        pages.extend(range(first, last + 1))
    if len(pages) != len(set(pages)):
        raise ValueError("Page ranges overlap")
    return sorted(pages)


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def prepare(pdf, work, spec):
    if work.exists():
        raise ValueError("Preparation directory exists; check it or use a new directory")
    count, pdf_hash = page_count(pdf), digest(pdf)
    selected = select_pages(spec, count)
    work.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{work.name}-", dir=work.parent) as temporary:
        root = Path(temporary)
        (root / "images").mkdir()
        (root / "text").mkdir()
        inputs, drafts = [], []
        for number in selected:
            stem = f"page-{number:06d}"
            prefix = root / "images" / stem
            rendered = run("pdftoppm", "-f", str(number), "-l", str(number),
                           "-singlefile", "-r", "180", "-png", str(pdf), str(prefix))
            image = prefix.with_suffix(".png")
            if rendered.returncode or not image.is_file() or image.stat().st_size == 0:
                raise ValueError(f"Cannot render PDF page {number}: " +
                                 rendered.stderr.decode(errors="replace"))
            warnings = [rendered.stderr.decode(errors="replace").strip()]
            try:
                extracted = run("pdftotext", "-f", str(number), "-l", str(number),
                                "-layout", "-enc", "UTF-8", str(pdf), "-")
                text = extracted.stdout.decode("utf-8").removesuffix("\f") if not extracted.returncode else ""
                state = "unavailable" if extracted.returncode else ("present" if text.strip() else "empty")
                warnings.append(extracted.stderr.decode(errors="replace").strip())
            except (OSError, UnicodeDecodeError) as exc:
                text, state = "", "unavailable"
                warnings.append(str(exc))
            text_path = root / "text" / f"{stem}.txt"
            text_path.write_text(text, encoding="utf-8")
            image_hash = digest(image)
            inputs.append({
                "physical_page": number,
                "image_path": image.relative_to(root).as_posix(),
                "image_sha256": image_hash,
                "native_text_path": text_path.relative_to(root).as_posix(),
                "native_text_sha256": digest(text_path),
                "native_text_state": state,
                "warnings": [warning for warning in warnings if warning],
            })
            drafts.append({
                "physical_page": number, "document_sha256": pdf_hash,
                "page_image_sha256": image_hash, "review_state": "unreviewed",
                "printed_page": None, "printed_page_state": "unverified",
                "headings": [], "summary": "", "content_types": [],
                "anchors": [], "issues": [],
            })
        if digest(pdf) != pdf_hash:
            raise ValueError("PDF changed during preparation")
        write_json(root / "manifest.json", {
            "schema_version": 1, "preparer_revision": REVISION,
            "document_sha256": pdf_hash, "page_count": count,
            "selected_pages": selected, "pages": inputs,
        })
        (root / "index.jsonl").write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in drafts), encoding="utf-8")
        root.rename(work)
    return {"work_dir": str(work), "selected_pages": selected, "review_state": "unreviewed"}


def strings(value):
    return isinstance(value, list) and all(isinstance(item, str) and item.strip() for item in value)


def check(pdf, work, index=None):
    work = work.resolve(strict=True)
    manifest = json.loads((work / "manifest.json").read_text(encoding="utf-8"))
    if (manifest["schema_version"] != 1 or manifest["preparer_revision"] != REVISION
            or manifest["document_sha256"] != digest(pdf) or manifest["page_count"] != page_count(pdf)):
        raise ValueError("PDF or preparation version does not match")
    selected = manifest["selected_pages"]
    if (not isinstance(selected, list) or not selected
            or any(type(page) is not int or not 1 <= page <= manifest["page_count"] for page in selected)
            or selected != sorted(set(selected))
            or [row["physical_page"] for row in manifest["pages"]] != selected):
        raise ValueError("Preparation page coverage is invalid")
    for row in manifest["pages"]:
        for prefix in ("image", "native_text"):
            path = (work / row[f"{prefix}_path"]).resolve()
            if not path.is_relative_to(work) or digest(path) != row[f"{prefix}_sha256"]:
                raise ValueError(f"Page {row['physical_page']} {prefix} identity does not match")
        text = (work / row["native_text_path"]).read_text(encoding="utf-8")
        state = row["native_text_state"]
        if state not in {"present", "empty", "unavailable"} or ((state == "present") != bool(text.strip())):
            raise ValueError("Native-text state does not match prepared text")
    result = {"document_sha256": manifest["document_sha256"], "selected_pages": selected,
              "scope": "full" if len(selected) == manifest["page_count"] else "partial"}
    if index is None:
        return result
    rows = [json.loads(line) for line in index.read_text(encoding="utf-8").splitlines()]
    if (any(type(row["physical_page"]) is not int for row in rows)
            or [row["physical_page"] for row in rows] != selected):
        raise ValueError("Index must cover exactly the selected pages in order")
    unresolved = []
    for row, source in zip(rows, manifest["pages"]):
        number = row["physical_page"]
        if (row["document_sha256"] != manifest["document_sha256"]
                or row["page_image_sha256"] != source["image_sha256"]):
            raise ValueError(f"Index page {number} source identity does not match")
        if (not strings(row["headings"]) or not strings(row["issues"])
                or not strings(row["content_types"]) or not set(row["content_types"]) <= CONTENT_TYPES
                or not isinstance(row["summary"], str) or not isinstance(row["anchors"], list)):
            raise ValueError(f"Index page {number} has invalid content fields")
        for anchor in row["anchors"]:
            if not isinstance(anchor, dict) or any(
                not isinstance(anchor.get(key), str) or not anchor[key].strip()
                for key in ("kind", "label", "locator")
            ):
                raise ValueError(f"Index page {number} has an invalid anchor")
        label_state, label = row["printed_page_state"], row["printed_page"]
        if (label_state not in {"verified", "absent", "unverified"}
                or (label_state == "verified" and (not isinstance(label, str) or not label.strip()))
                or (label_state != "verified" and label is not None)
                or (label_state == "unverified" and not row["issues"])):
            raise ValueError(f"Index page {number} has invalid printed-page evidence")
        if row["review_state"] == "unresolved":
            if (not row["issues"] or row["summary"] or row["headings"] or row["anchors"]
                    or row["content_types"] or label_state != "unverified"):
                raise ValueError(f"Unresolved page {number} must retain only identity and issues")
            unresolved.append(number)
        elif row["review_state"] != "reviewed" or not row["summary"].strip():
            raise ValueError(f"Index page {number} still needs image review and a summary")
    return {**result, "unresolved_pages": unresolved, "all_pages_reviewed": not unresolved}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    preparation = commands.add_parser("prepare", help="prepare selected PDF page images and text")
    preparation.add_argument("pdf", type=Path)
    preparation.add_argument("work_dir", type=Path)
    preparation.add_argument("--pages", required=True, help="1-based PDF pages: 1-3,5 or all")
    validation = commands.add_parser("check", help="check source files and optional completed index")
    validation.add_argument("pdf", type=Path)
    validation.add_argument("work_dir", type=Path)
    validation.add_argument("--index", type=Path)
    args = parser.parse_args()
    try:
        pdf, work = args.pdf.resolve(strict=True), args.work_dir.resolve()
        result = prepare(pdf, work, args.pages) if args.command == "prepare" else check(pdf, work, args.index)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(1, f"Error: {exc}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
