#!/usr/bin/env python3
"""Create source-bound HTML overlays and line coordinates for textbook location review."""
import argparse
import base64
import html
import json
import math
import re
from pathlib import Path
import xml.etree.ElementTree as ET

from pdf_index import digest, run, select_pages, page_count, write_json


def rectangle(region):
    values = [region[k] for k in ('x', 'y', 'width', 'height')]
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
        raise ValueError('Region coordinates must be finite numbers')
    x, y, w, h = values
    if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > 1 or y + h > 1:
        raise ValueError('Region must be inside the full page (0–1)')
    return x, y, x + w, y + h


def text_lines(pdf, page):
    result = run('pdftotext', '-f', str(page), '-l', str(page), '-bbox-layout', str(pdf), '-')
    if result.returncode:
        raise ValueError(result.stderr.decode(errors='replace'))
    xml = result.stdout.decode('utf-8', errors='replace')
    xml, replaced = re.subn(r'[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]', '\ufffd', xml)
    warnings = [result.stderr.decode(errors='replace').strip()]
    if replaced:
        warnings.append(f'{replaced} invalid XML characters replaced; verify text against image')
    root = ET.fromstring(xml)
    node = root.find('.//{*}page')
    if node is None:
        raise ValueError('No page in extracted text')
    width, height = float(node.attrib['width']), float(node.attrib['height'])
    lines = []
    for line in node.findall('.//{*}line'):
        a = line.attrib
        lines.append({'number': len(lines) + 1,
                      'text': ' '.join(''.join(word.itertext()) for word in line.findall('.//{*}word')),
                      'region': {'x': float(a['xMin']) / width, 'y': float(a['yMin']) / height,
                                 'width': (float(a['xMax']) - float(a['xMin'])) / width,
                                 'height': (float(a['yMax']) - float(a['yMin'])) / height}})
    return {'lines': lines, 'warning': "; ".join(filter(None, warnings)) or None}


def cut_lines(region, lines):
    x, y, right, bottom = rectangle(region)
    cuts = []
    for line in lines:
        lx, ly, lr, lb = rectangle(line['region'])
        overlap = max(0, min(right, lr) - max(x, lx)) * max(0, min(bottom, lb) - max(y, ly))
        fraction = overlap / ((lr - lx) * (lb - ly))
        if 0.05 < fraction < 0.95:
            cuts.append(line['number'])
    return cuts


def review(pdf, files, root, output, pages='all', ids=()):
    source_hash = digest(pdf)
    count = page_count(pdf)
    selected = set(select_pages(pages, count))
    entries, seen, found = [], set(), set()
    for file in files:
        data = json.loads(file.read_text())
        if data['documentSha256'] != source_hash or data['coordinateSystem'] != 'normalized-full-page-top-left':
            raise ValueError(f'{file}: PDF identity or coordinate system mismatch')
        for location in data['locations']:
            identity = location['id']
            if identity in seen:
                raise ValueError(f'Duplicate location: {identity}')
            seen.add(identity)
            if ids and identity not in ids:
                continue
            for part, item in enumerate([location, *location.get('additionalRegions', [])]):
                page = item['page']
                if type(page) is not int or not 1 <= page <= count:
                    raise ValueError(f'{identity}: invalid PDF page {page}')
                if page not in selected:
                    continue
                rectangle(item['region'])
                image = root / data['sourceImages'] / f'page-{page:06d}.png'
                if digest(image) != item['sourceImageSha256']:
                    raise ValueError(f'{identity} part {part}: image identity mismatch')
                found.add(identity)
                entries.append({'id': identity, 'part': part, 'page': page, 'region': item['region'],
                                'sourceImageSha256': item['sourceImageSha256'], 'image': image,
                                'locator': location['locator']})
    if not entries or set(ids) - found:
        raise ValueError(f'No regions in scope, or requested IDs missing: {sorted(set(ids) - found)}')
    page_data = {}
    for page in sorted({item['page'] for item in entries}):
        try:
            page_data[page] = text_lines(pdf, page)
        except (FileNotFoundError, ValueError, ET.ParseError) as error:
            page_data[page] = {'lines': [], 'warning': str(error)}
    cards, records = [], []
    for entry in entries:
        item = {key: value for key, value in entry.items() if key != 'image'}
        item['possiblyCutLines'] = cut_lines(item['region'], page_data[item['page']]['lines'])
        records.append(item)
        r = item['region']
        warning = html.escape(page_data[item['page']]['warning'] or '')
        label = html.escape(f"{item['id']} · part {item['part']} · PDF {item['page']}")
        image = base64.b64encode(entry['image'].read_bytes()).decode()
        cards.append(f'<article><h2>{label}</h2><p>{html.escape(item["locator"])}</p>'
                     f'<p>可能切断的文本行：{item["possiblyCutLines"]}（需人工判断）</p>'
                     f'<p>{warning}</p>'
                     f'<div class="page"><img src="data:image/png;base64,{image}">'
                     f'<div class="box" style="left:{r["x"]*100}%;top:{r["y"]*100}%;'
                     f'width:{r["width"]*100}%;height:{r["height"]*100}%"></div></div></article>')
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / 'review.json', {'documentSha256': source_hash, 'reviewState': 'unreviewed',
               'pages': sorted(page_data), 'textByPage': page_data, 'regions': records})
    (output / 'review.html').write_text('<!doctype html><meta charset="utf-8"><title>定位核对</title>'
        '<style>body{font:16px sans-serif;background:#eee;margin:24px}article{max-width:900px;margin:0 auto 40px}'
        '.page{position:relative}.page img{width:100%;display:block}.box{position:absolute;box-sizing:border-box;'
        'border:2px solid #c05000;background:#ffb00018;pointer-events:none}</style>'
        '<h1>原页定位核对 · 未经视觉审核</h1><p>无警告不代表完整：续行、图表和续页仍需核对。</p>'
        + ''.join(cards), encoding='utf-8')
    return {'pages': sorted(page_data), 'regions': len(records),
            'flagged': sum(bool(item['possiblyCutLines']) for item in records)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('locations', type=Path, nargs='+')
    parser.add_argument('--root', type=Path, default=Path.cwd(), help='Base for sourceImages paths')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--pages', default='all', help='PDF pages, e.g. 12-13,87')
    parser.add_argument('--id', action='append', default=[], help='Repeat for multiple location IDs')
    args = parser.parse_args()
    print(json.dumps(review(args.pdf, args.locations, args.root, args.output, args.pages, args.id)))


if __name__ == '__main__':
    main()
