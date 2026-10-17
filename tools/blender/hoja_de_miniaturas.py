"""Junta las miniaturas (.thumb) de una categoría de MPFB en una sola imagen para elegir piezas.

Uso:
  blender.exe --background --python tools/blender/hoja_de_miniaturas.py -- clothes docs/previews/hoja-ropa.png [columnas] [tamaño]
Imprime el índice -> nombre en el mismo orden que la rejilla (izquierda a derecha, arriba a abajo).
"""
import os
import sys

import bpy
import numpy as np

USER_DATA = os.path.join(
    os.environ["APPDATA"], "Blender Foundation", "Blender", "5.2",
    "extensions", ".user", "blender_org", "mpfb", "data",
)

args = sys.argv[sys.argv.index("--") + 1:]
category, out = args[0], os.path.abspath(args[1])
cols = int(args[2]) if len(args) > 2 else 10
size = int(args[3]) if len(args) > 3 else 128

folder = os.path.join(USER_DATA, category)
names = sorted(
    n for n in os.listdir(folder)
    if os.path.isfile(os.path.join(folder, n, n + ".thumb"))
)
rows = (len(names) + cols - 1) // cols
sheet = np.zeros((rows * size, cols * size, 4), dtype=np.float32)
sheet[..., 3] = 1.0
sheet[..., :3] = 0.18

for index, name in enumerate(names):
    img = bpy.data.images.load(os.path.join(folder, name, name + ".thumb"))
    img.scale(size, size)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
    alpha = px[..., 3:4]
    px = px[..., :3] * alpha + 0.18 * (1 - alpha)
    row, col = divmod(index, cols)
    # Blender guarda las imágenes de abajo hacia arriba
    y0 = (rows - 1 - row) * size
    sheet[y0:y0 + size, col * size:(col + 1) * size, :3] = px
    print("%3d  %s" % (index, name))
    bpy.data.images.remove(img)

result = bpy.data.images.new("hoja", cols * size, rows * size, alpha=True)
result.pixels = sheet.flatten().tolist()
result.filepath_raw = out
result.file_format = "PNG"
result.save()
print("hoja guardada en", out)
