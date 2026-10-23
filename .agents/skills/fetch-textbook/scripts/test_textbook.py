"""Offline checks for download failure and local file preservation."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import textbook
from pypdf.errors import PdfReadError
from tchmaterial_parser.api import ResourceInfo


class DownloadChecks(unittest.TestCase):
    def test_existing_material_is_preserved_without_network(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "book.pdf"
            for existing in (target, target.with_suffix(".source.json")):
                existing.write_bytes(b"keep")
                with patch.object(textbook.api, "parse") as parse:
                    with self.assertRaises(FileExistsError):
                        textbook.download("540ac93d-67fc-4353-9e49-1ef20d02b5a4", target)
                    parse.assert_not_called()
                self.assertEqual(existing.read_bytes(), b"keep")
                existing.unlink()

    def test_failed_or_invalid_download_leaves_no_files(self):
        resource = ResourceInfo("test", "https://example.invalid/book.pdf", "pdf", [])
        for body in (None, b"not a PDF"):
            with self.subTest(body=body), tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / "book.pdf"

                def fake_download(url, output, current_state):
                    if body is None:
                        current_state["failed_reason"] = "HTTP 403"
                    else:
                        Path(output).write_bytes(body)

                with (
                    patch.object(textbook.config, "load_config", return_value={}),
                    patch.object(textbook.api, "parse", return_value=[resource]),
                    patch.object(textbook, "download_file", side_effect=fake_download) as download,
                ):
                    with self.assertRaises(RuntimeError if body is None else PdfReadError):
                        textbook.download("540ac93d-67fc-4353-9e49-1ef20d02b5a4", target)
                    download.assert_called_once()
                self.assertEqual(list(Path(folder).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
