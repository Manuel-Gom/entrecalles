"""Hoja de contacto de piezas puestas sobre cuerpos, para revisar barbas, gafas, sombreros o peinados.

Uso (desde la raíz del proyecto, con los modelos ya exportados):
  blender.exe --background --python tools/blender/previsualizar_piezas.py -- salida.png "cuerpo|hueco:id,hueco:id;cuerpo|..." [opciones]

Cada mosaico se separa con ";" y empieza con el cuerpo, una barra "|" y las piezas ("hueco:id" separadas por comas).
Dos claves especiales dentro de un mosaico: "tinte:RRGGBB" tiñe pelo y barba como el navegador, y "tinc:RRGGBB"
multiplica la textura de torso, piernas, calzado, cabeza y conjunto por ese color (piezas con "tinte": true);
"tinc_cabeza:RRGGBB" (o tinc_torso, etc.) lo hace solo en ese hueco.
Opciones:
  --azimut 0,40       ángulos de la cámara en grados (un mosaico por ángulo)
  --zona cara|cabeza|busto|cuerpo|pies   encuadre (por defecto cabeza)
  --px 300            tamaño de cada mosaico
  --columnas N        columnas de la hoja
Con SALIDA_DIR se leen los modelos de otra carpeta.
"""
import os
import sys

import bpy  # noqa: F401
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vista  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
salida = os.path.abspath(args[0])
mosaicos = args[1]
resto = args[2:]


def opcion(nombre, defecto):
    return resto[resto.index(nombre) + 1] if nombre in resto else defecto


azimutes = [float(a) for a in opcion("--azimut", "0").split(",")]
zona = opcion("--zona", "cabeza")
px = int(opcion("--px", "300"))
columnas = int(opcion("--columnas", str(len(azimutes))))
TEMP = os.path.join(os.environ.get("TEMP", "."), "piezas_prev.png")

# zona: (distancia del centro a la coronilla, alto visible) en metros; "cuerpo" usa la altura entera
ZONAS = {"cara": (0.11, 0.26), "cabeza": (0.12, 0.40), "busto": (0.22, 0.62), "pies": (None, 0.3)}

vista.preparar(px, px, muestras=24)
imagenes = []
for texto in mosaicos.split(";"):
    cuerpo, piezas = texto.split("|")
    piezas = dict(p.split(":") for p in piezas.split(",") if p)
    tinte, tinc = piezas.pop("tinte", None), piezas.pop("tinc", None)
    por_hueco = {k[5:]: piezas.pop(k) for k in list(piezas) if k.startswith("tinc_")}
    vista.limpiar()
    objetos = vista.montar(cuerpo, piezas, sin_defecto=True)
    if tinte:
        for hueco in ("pelo", "barba"):
            if hueco in objetos:
                vista.tenir_pelo(objetos[hueco], "#" + tinte)
    for hueco in ("torso", "piernas", "calzado", "cabeza", "conjunto"):
        color = por_hueco.get(hueco) or tinc
        if color and hueco in objetos:
            vista.tenir_prenda(objetos[hueco], "#" + color)
    todos = [o for lista in objetos.values() for o in lista]
    vista.bajar_brazos(todos)
    _, _, z0, z1 = vista.limites(objetos["cuerpo"])
    if zona == "cuerpo":
        z, alto = (z0 + z1) / 2, (z1 - z0) * 1.1
    elif zona == "pies":
        suelo = vista.limites(objetos.get("calzado") or objetos["cuerpo"])[2]
        z, alto = suelo + ZONAS[zona][1] / 2, ZONAS[zona][1]
    else:
        z, alto = z1 - ZONAS[zona][0], ZONAS[zona][1]
    centro = Vector((0, 0, z))
    vista.luces(centro)
    for azimut in azimutes:
        vista.camara(centro, alto, azimut, 0)
        vista.renderizar(TEMP)
        imagenes.append(vista.leer_png(TEMP))
vista.guardar_hoja(salida, imagenes, columnas)
print("[piezas] hoja guardada en", salida)
