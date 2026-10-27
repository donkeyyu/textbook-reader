import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

from pdf_index import digest
from review_locations import cut_lines, rectangle, review, text_lines


class LocationReviewChecks(unittest.TestCase):
    def test_cut_line_and_complete_region(self):
        lines = [{'number': 1, 'region': {'x': .1, 'y': .2, 'width': .7, 'height': .02}},
                 {'number': 2, 'region': {'x': .1, 'y': .24, 'width': .7, 'height': .02}}]
        self.assertEqual(cut_lines({'x': .1, 'y': .2, 'width': .2, 'height': .02}, lines), [1])
        self.assertEqual(cut_lines({'x': .09, 'y': .19, 'width': .72, 'height': .08}, lines), [])
        # A wholly omitted continuation cannot be detected by line intersection.
        self.assertEqual(cut_lines({'x': .09, 'y': .19, 'width': .72, 'height': .04}, lines), [])
        for value in (float('nan'), float('inf'), -.1, True):
            with self.assertRaises(ValueError):
                rectangle({'x': value, 'y': 0, 'width': .2, 'height': .1})

    def test_poppler_control_characters_keep_coordinates_and_warning(self):
        xml = b'<html xmlns="http://www.w3.org/1999/xhtml"><page width="100" height="200"><line xMin="10" yMin="20" xMax="80" yMax="30"><word>abc\x02</word></line></page></html>'
        with patch('review_locations.run', return_value=subprocess.CompletedProcess([], 0, xml, b'PDF warning')):
            result = text_lines(Path('book.pdf'), 1)
        self.assertEqual(result['lines'][0]['region']['width'], .7)
        self.assertIn('invalid XML', result['warning'])
        self.assertIn('PDF warning', result['warning'])

    def test_continuation_and_source_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = root / 'book.pdf'
            pdf.write_bytes(b'PDF identity')
            parts = []
            for page in (1, 2):
                image = root / f'page-{page:06d}.png'
                image.write_bytes(b'page image')
                parts.append({'page': page, 'region': {'x': .1, 'y': .2, 'width': .7, 'height': .1},
                              'sourceImageSha256': digest(image)})
            data = {'documentSha256': digest(pdf), 'coordinateSystem': 'normalized-full-page-top-left',
                    'sourceImages': '.', 'locations': [{'id': 'question', 'locator': '<test>',
                    **parts[0], 'additionalRegions': [parts[1]]}]}
            source = root / 'locations.json'
            source.write_text(json.dumps(data))
            with patch('review_locations.page_count', return_value=2), patch('review_locations.text_lines', return_value={'lines': [], 'warning': None}):
                result = review(pdf, [source], root, root / 'out', ids=['question'])
                self.assertEqual(result['pages'], [1, 2])
                self.assertEqual(result['regions'], 2)
                self.assertIn('&lt;test&gt;', (root / 'out/review.html').read_text())
                with self.assertRaises(ValueError):
                    review(pdf, [source], root, root / 'missing', ids=['unknown'])
                (root / 'page-000002.png').write_bytes(b'changed')
                with self.assertRaises(ValueError):
                    review(pdf, [source], root, root / 'bad')


if __name__ == '__main__':
    unittest.main()
