"""Hoja de contacto de los cuerpos de public/models/modular, cada uno con su atuendo por defecto.

Importa body.glb y las piezas por defecto de cada cuerpo (según manifest.json) y las dibuja juntas.

Uso (desde la raíz del proyecto):
  blender.exe --background --python tools/blender/previsualizar_todos.py -- salida.png [frente|lateral] [--genero mujer|hombre] [--ids lucia,sofia]
Sin filtros dibuja todos los cuerpos. Con la variable SALIDA_DIR se leen los modelos de otra carpeta.
"""
import os
import sys

import bpy  # noqa: F401
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vista  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
salida = os.path.abspath(args[0])
resto = args[1:]
angulo = 90 if "lateral" in resto else 0
genero = resto[resto.index("--genero") + 1] if "--genero" in resto else None
ids = resto[resto.index("--ids") + 1].split(",") if "--ids" in resto else None
ANCHO, ALTO, COLUMNAS = 360, 560, 5

manifest = vista.cargar_manifest()
cuerpos = [c for c in manifest["cuerpos"]
           if (genero is None or c["genero"] == genero) and (ids is None or c["id"] in ids)]

vista.preparar(ANCHO, ALTO, muestras=24)
mosaicos = []
for cuerpo in cuerpos:
    vista.limpiar()
    objetos = vista.montar(cuerpo["id"], vista.defecto_con_ocultas(cuerpo, manifest))
    if cuerpo.get("colorPelo") and "pelo" in objetos:
        vista.tenir_pelo(objetos["pelo"], cuerpo["colorPelo"])
    todos = [o for lista in objetos.values() for o in lista]
    x0, x1, z0, z1 = vista.limites(todos)
    alto = z1 - z0
    centro = Vector((0, 0, (z0 + z1) / 2))
    vista.luces(centro)
    vista.camara(centro, alto * 1.12, azimut=angulo, lente=70)
    ruta = os.path.join(os.environ.get("TEMP", "."), "mosaico.png")
    vista.renderizar(ruta)
    mosaicos.append(vista.leer_png(ruta))
    print("[todos]", cuerpo["id"], "alto %.2f m" % alto, flush=True)

vista.guardar_hoja(salida, mosaicos, COLUMNAS)
print("[todos] hoja guardada en", salida)
