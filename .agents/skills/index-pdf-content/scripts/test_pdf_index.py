import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import pdf_index


class PdfIndexChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.pdf = self.root / "book.pdf"
        self.pdf.write_bytes(b"test PDF identity")
        self.work = self.root / "prepared"
        self.addCleanup(patch.stopall)
        patch.object(pdf_index, "page_count", return_value=3).start()
        patch.object(pdf_index, "run", side_effect=self.poppler).start()

    def poppler(self, *args):
        number = args[args.index("-f") + 1]
        if args[0] == "pdftoppm":
            Path(args[-1]).with_suffix(".png").write_bytes(f"page image {number}".encode())
            return subprocess.CompletedProcess(args, 0, b"", b"render warning")
        return subprocess.CompletedProcess(args, 0, f"page text {number}\n\f".encode(), b"")

    def reviewed_index(self):
        path = self.work / "index.jsonl"
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        for row in rows:
            row.update(review_state="reviewed", printed_page_state="absent",
                       summary="A reviewed page", content_types=["text"])
        self.write_index(rows)
        return rows

    def write_index(self, rows):
        path = self.work / "index.jsonl"
        path.write_text("".join(json.dumps(row) + "\n" for row in rows))
        return path

    def test_scope_and_exact_index_coverage(self):
        pdf_index.prepare(self.pdf, self.work, "2-3")
        rows = self.reviewed_index()
        result = pdf_index.check(self.pdf, self.work, self.work / "index.jsonl")
        self.assertEqual(result["selected_pages"], [2, 3])
        self.assertEqual(result["scope"], "partial")
        self.assertTrue(result["all_pages_reviewed"])
        for invalid in (rows[:1], rows + rows[:1], list(reversed(rows))):
            with self.subTest(pages=[row["physical_page"] for row in invalid]):
                with self.assertRaises(ValueError):
                    pdf_index.check(self.pdf, self.work, self.write_index(invalid))

    def test_source_changes_and_damaged_files_are_rejected(self):
        pdf_index.prepare(self.pdf, self.work, "1")
        original = self.pdf.read_bytes()
        self.pdf.write_bytes(b"a different book")
        with self.assertRaises(ValueError):
            pdf_index.check(self.pdf, self.work)
        self.pdf.write_bytes(original)
        for path in (self.work / "images/page-000001.png", self.work / "text/page-000001.txt"):
            original = path.read_bytes()
            path.write_bytes(b"changed")
            with self.assertRaises(ValueError):
                pdf_index.check(self.pdf, self.work)
            path.write_bytes(original)
        with self.assertRaises(ValueError):
            pdf_index.prepare(self.pdf, self.work, "2")
        self.assertEqual(pdf_index.check(self.pdf, self.work)["selected_pages"], [1])

    def test_unreviewed_draft_and_unresolved_page_remain_distinct(self):
        pdf_index.prepare(self.pdf, self.work, "all")
        with self.assertRaises(ValueError):
            pdf_index.check(self.pdf, self.work, self.work / "index.jsonl")
        rows = self.reviewed_index()
        rows[1].update(review_state="unresolved", printed_page_state="unverified",
                       summary="", content_types=[], issues=["Image could not be read"])
        result = pdf_index.check(self.pdf, self.work, self.write_index(rows))
        self.assertEqual(result["scope"], "full")
        self.assertEqual(result["unresolved_pages"], [2])
        self.assertFalse(result["all_pages_reviewed"])

    def test_missing_text_tool_keeps_visual_inputs(self):
        def without_text(*args):
            if args[0] == "pdftotext":
                raise FileNotFoundError("pdftotext")
            return self.poppler(*args)

        with patch.object(pdf_index, "run", side_effect=without_text):
            pdf_index.prepare(self.pdf, self.work, "1")
        manifest = json.loads((self.work / "manifest.json").read_text())
        self.assertEqual(manifest["pages"][0]["native_text_state"], "unavailable")
        self.assertTrue(manifest["pages"][0]["warnings"])
        pdf_index.check(self.pdf, self.work)

    def test_render_failure_leaves_no_partial_preparation(self):
        with patch.object(pdf_index, "run", return_value=subprocess.CompletedProcess(
            [], 1, b"", b"cannot render"
        )):
            with self.assertRaises(ValueError):
                pdf_index.prepare(self.pdf, self.work, "1")
        self.assertFalse(self.work.exists())
        self.assertEqual(list(self.root.iterdir()), [self.pdf])

    def test_outside_paths_and_wrong_image_bindings_are_rejected(self):
        pdf_index.prepare(self.pdf, self.work, "1")
        rows = self.reviewed_index()
        rows[0]["page_image_sha256"] = "0" * 64
        with self.assertRaises(ValueError):
            pdf_index.check(self.pdf, self.work, self.write_index(rows))
        manifest_path = self.work / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        external = self.root / "external.png"
        external.write_bytes((self.work / "images/page-000001.png").read_bytes())
        manifest["pages"][0]["image_path"] = "../external.png"
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            pdf_index.check(self.pdf, self.work)


if __name__ == "__main__":
    unittest.main()
