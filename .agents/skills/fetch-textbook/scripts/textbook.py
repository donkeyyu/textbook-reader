#!/usr/bin/env python3
"""Search and fetch one textbook with tchMaterial-parser's existing functions."""

import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID

from pypdf import PdfReader
from tchmaterial_parser import api, config
from tchmaterial_parser.catalog import ResourceHelper, filter_resource_items
from tchmaterial_parser.ui.download_panel import create_download_state, download_file


def search(query):
    items = filter_resource_items(ResourceHelper().fetch_book_list(), query)

    def leaves(nodes, path=()):
        for content_id, node in nodes.items():
            route = (*path, node["display_name"])
            if node.get("children"):
                yield from leaves(node["children"], route)
            else:
                yield {"content_id": content_id, "path": route}

    results = list(leaves(items))
    if not results:
        raise ValueError("没有匹配教材；请调整查询词。")
    return results


def download(content_id, output):
    content_id = str(UUID(content_id))
    output = Path(output).expanduser().resolve()
    source_path = output.with_suffix(".source.json")
    if output.suffix.lower() != ".pdf":
        raise ValueError("目标文件须以 .pdf 结尾。")
    for target in (output, source_path):
        if target.exists():
            raise FileExistsError(f"保留已有文件：{target}")

    config.load_access_token(config.load_config())
    page_url = (
        "https://basic.smartedu.cn/tchMaterial/detail?contentType=assets_document"
        f"&contentId={content_id}&catalogType=tchMaterial&subCatalog=tchMaterial"
    )
    resources = api.parse(page_url, False)
    if not resources:
        raise RuntimeError("资源解析失败。")
    pdfs = [resource for resource in resources if resource.file_format.lower() == "pdf"]
    if len(pdfs) != 1:
        raise ValueError(f"预期一本 PDF，实际 {len(pdfs)}；请核对教材页面。")
    book = pdfs[0]

    parser_root = Path(api.__file__).resolve().parents[2]
    parser_commit = subprocess.check_output(
        ["git", "-C", str(parser_root), "rev-parse", "HEAD"], text=True
    ).strip()
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".textbook-", dir=output.parent) as temporary:
        staged = Path(temporary) / "book.pdf"
        state = create_download_state(book.url, str(staged))
        download_file(book.url, str(staged), current_state=state)
        if state["failed_reason"] or state["stopped"] or not staged.is_file():
            raise RuntimeError(state["failed_reason"] or "下载已停止或未产生文件。")
        reader = PdfReader(staged)
        page_count = len(reader.pages)
        if page_count == 0:
            raise ValueError("PDF 没有页面。")
        digest = hashlib.sha256()
        with staged.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        record = {
            "content_id": content_id,
            "title": book.title,
            "edition": book.edition,
            "classification": book.relative_dir,
            "page_url": page_url,
            "resource_url": book.url,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "local_file": output.name,
            "bytes": staged.stat().st_size,
            "sha256": digest.hexdigest(),
            "pdf_page_count": page_count,
            "parser": {
                "repository": "https://github.com/happycola233/tchMaterial-parser",
                "version": version("tchMaterial-parser"),
                "commit": parser_commit,
            },
            "verification": {"status": "pending_visual_review"},
        }
        staged_source = Path(temporary) / "source.json"
        staged_source.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        # Staging shares the output filesystem; hard links publish complete files without overwriting.
        os.link(staged, output)
        try:
            os.link(staged_source, source_path)
        except OSError:
            output.unlink()
            raise
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    query = commands.add_parser("search", help="按分类路径查询教材")
    query.add_argument("query")
    fetch = commands.add_parser("download", help="下载一个 content_id 对应的 PDF")
    fetch.add_argument("content_id")
    fetch.add_argument("output")
    args = parser.parse_args()
    try:
        result = search(args.query) if args.command == "search" else download(args.content_id, args.output)
    except Exception as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
