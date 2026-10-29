"""A photo | before | after sheet: one column per group, each image scaled to the column's width, stacked down it.

    python -I compare.py out.jpg --col photo1.jpg photo2.jpg --col before1.png --col after1.png after2.png [--width 700]

Columns are labelled with their position (PHOTO, BEFORE, AFTER, then 4, 5 ...) unless --labels gives names."""
import argparse
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument('out')
ap.add_argument('--col', nargs='+', action='append', required=True)
ap.add_argument('--labels', nargs='+')
ap.add_argument('--width', type=int, default=700)
a = ap.parse_args()
labels = a.labels or ['PHOTO', 'BEFORE', 'AFTER'] + [str(i + 1) for i in range(3, len(a.col))]
W, top = a.width, 36
cols = [[(lambda i: i.resize((W, int(i.height * W / i.width)), Image.LANCZOS))(Image.open(f).convert('RGB')) for f in c] for c in a.col]
H = max(sum(i.height for i in c) for c in cols) + top
sheet = Image.new('RGB', (W * len(cols), H), 'white')
draw = ImageDraw.Draw(sheet)
for k, c in enumerate(cols):
    draw.text((k * W + 10, 10), labels[k] if k < len(labels) else str(k + 1), fill='black')
    y = top
    for i in c:
        sheet.paste(i, (k * W, y)); y += i.height
sheet.save(a.out, quality=88)
print(a.out, sheet.size)
