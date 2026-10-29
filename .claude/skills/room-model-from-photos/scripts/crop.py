import sys
from PIL import Image
# crop.py src out x0 y0 x1 y1 scale
s, o, x0, y0, x1, y1, k = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7]), float(sys.argv[7])
i = Image.open(s).crop((x0, y0, x1, y1)); i = i.resize((int(i.width * k), int(i.height * k)), Image.LANCZOS); i.save(o)
