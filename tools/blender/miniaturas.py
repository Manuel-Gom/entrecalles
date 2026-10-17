"""Genera las miniaturas PNG del editor de personajes a partir de los .glb ya exportados (crear_modular.py).

Uso (desde la raíz del proyecto, tras exportar los modelos):
  blender.exe --background --python tools/blender/miniaturas.py -- [opciones]

Opciones (todas opcionales):
  --solo cuerpos|piezas   solo una de las dos familias
  --ids a,b,c             solo esos cuerpos o piezas
  --salida carpeta        carpeta de destino (por defecto public/models/modular/miniaturas)
  --escala N              multiplica la resolución (para revisar detalles; no cuantiza los colores)
  --referencia id         usa ese cuerpo como maniquí de todas las piezas (para comprobar una prenda sobre otro cuerpo)
  --hoja ruta.png         además guarda una hoja de contacto con todas las miniaturas generadas

Salida (PNG con fondo transparente, 8 bits con paleta para que pesen poco):
  <salida>/cuerpos/<cuerpo>.png   busto (cabeza y torso) con su atuendo por defecto, 256x320
  <salida>/<hueco>/<pieza>.png    la pieza sobre un cuerpo de referencia, 192x192

Cuerpo de referencia de las piezas: el primer cuerpo masculino del catálogo (el primero femenino para las
piezas solo de mujer), pintado de gris liso para que se lea la prenda y no el maniquí. Los brazos se bajan
a una postura natural. Al terminar añade "miniatura": true a los cuerpos y piezas de manifest.json.
Las rutas son fijas: miniaturas/cuerpos/<id>.png y miniaturas/<hueco>/<id>.png.
"""
import json
import os
import sys

import bpy  # noqa: F401
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vista  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opcion(nombre, defecto=None):
    return args[args.index(nombre) + 1] if nombre in args else defecto


SOLO = opcion("--solo")
IDS = opcion("--ids").split(",") if opcion("--ids") else None
SALIDA = os.path.abspath(opcion("--salida", os.path.join(vista.MODULAR, "miniaturas")))
ESCALA = int(opcion("--escala", "1"))
HOJA = opcion("--hoja")
REFERENCIA = opcion("--referencia")
TAMANO_CUERPO = (256, 320)
TAMANO_PIEZA = (192, 192)
TEMP = os.path.join(os.environ.get("TEMP", "."), "miniatura.png")

# (azimut, elevación) de la cámara por hueco; el calzado se ve mejor de tres cuartos y desde arriba
VISTA = {"calzado": (35, 18)}


def log(msg):
    print("[miniaturas]", msg, flush=True)


def dibujar(ancho, alto, centro, alto_visible, azimut=0.0, elevacion=0.0):
    vista.preparar(ancho * ESCALA, alto * ESCALA, muestras=24, transparente=True)
    vista.luces(centro)
    vista.camara(centro, alto_visible, azimut, elevacion)
    vista.renderizar(TEMP)
    return vista.leer_png(TEMP)


def guardar(ruta, imagen, colores=255):
    if ESCALA > 1:
        vista.guardar_array(ruta, imagen.astype(np.float32) / 255)
        return os.path.getsize(ruta)
    return vista.guardar_png8(ruta, imagen, colores)


def miniatura_cuerpo(cuerpo, manifest):
    vista.limpiar()
    objetos = vista.montar(cuerpo["id"], vista.defecto_con_ocultas(cuerpo, manifest))
    if cuerpo.get("colorPelo") and "pelo" in objetos:
        vista.tenir_pelo(objetos["pelo"], cuerpo["colorPelo"])
    todos = [o for lista in objetos.values() for o in lista]
    vista.bajar_brazos(todos)
    _, _, _, cima = vista.limites(todos)
    alto_visible = 0.74
    centro = Vector((0, 0, cima + 0.05 - alto_visible / 2))
    return dibujar(*TAMANO_CUERPO, centro, alto_visible)


def encuadre_pieza(hueco, cuerpo_objs, pieza_objs):
    """(centro, alto visible) para que se vea la pieza entera sobre su zona del cuerpo."""
    _, _, _, cima_cuerpo = vista.limites(cuerpo_objs)
    px0, px1, pz0, pz1 = vista.limites(pieza_objs)
    if hueco in ("pelo", "cabeza"):
        arriba = max(pz1, cima_cuerpo) + 0.03
        abajo = min(max(pz0, cima_cuerpo - 0.42), cima_cuerpo - 0.26)
        if hueco == "cabeza":
            abajo = cima_cuerpo - 0.26
        alto = max(arriba - abajo, px1 - px0) * 1.08
        return Vector(((px0 + px1) / 2 if hueco == "pelo" else 0, 0, (arriba + abajo) / 2)), alto
    if hueco in ("barba", "gafas"):
        # la cara entera (frente a barbilla), centrada: la pieza sola se vería a un tamaño absurdo
        return Vector((0, 0, cima_cuerpo - 0.115)), 0.27
    alto = max(pz1 - pz0, px1 - px0) * (1.3 if hueco == "calzado" else 1.12)
    return Vector(((px0 + px1) / 2, 0, (pz0 + pz1) / 2)), alto


def miniaturas_piezas(manifest, piezas, referencias):
    resultados = []
    for cuerpo_id, grupo in referencias.items():
        if not grupo:
            continue
        vista.limpiar()
        cuerpo = vista.montar(cuerpo_id, {})["cuerpo"]
        vista.maniqui(cuerpo)
        vista.bajar_brazos(cuerpo)
        for pieza in grupo:
            nuevos = vista.importar(os.path.join(vista.MODULAR, cuerpo_id, pieza["slot"], pieza["id"] + ".glb"))
            vista.tenir_defecto(nuevos, pieza)
            vista.bajar_brazos(nuevos)
            centro, alto = encuadre_pieza(pieza["slot"], cuerpo, nuevos)
            azimut, elevacion = VISTA.get(pieza["slot"], (0, 0))
            imagen = dibujar(*TAMANO_PIEZA, centro, alto, azimut, elevacion)
            ruta = os.path.join(SALIDA, pieza["slot"], pieza["id"] + ".png")
            peso = guardar(ruta, imagen)
            resultados.append((pieza, imagen, peso))
            log("%s/%s (sobre %s) %.1f KB" % (pieza["slot"], pieza["id"], cuerpo_id, peso / 1024))
            for obj in nuevos:
                bpy.data.objects.remove(obj, do_unlink=True)
    return resultados


def main():
    manifest = vista.cargar_manifest()
    hoja_cuerpos, hoja_piezas = [], []

    if SOLO != "piezas":
        for cuerpo in manifest["cuerpos"]:
            if IDS and cuerpo["id"] not in IDS:
                continue
            imagen = miniatura_cuerpo(cuerpo, manifest)
            peso = guardar(os.path.join(SALIDA, "cuerpos", cuerpo["id"] + ".png"), imagen, 96)
            hoja_cuerpos.append(imagen)
            log("cuerpos/%s %.1f KB" % (cuerpo["id"], peso / 1024))

    if SOLO != "cuerpos":
        primero = {}
        for cuerpo in manifest["cuerpos"]:
            primero.setdefault(cuerpo["genero"], cuerpo["id"])
        grupos = {cid: [] for cid in primero.values()}
        for pieza in manifest["piezas"]:
            if IDS and pieza["id"] not in IDS:
                continue
            genero = "hombre" if "hombre" in pieza["para"] else "mujer"
            grupos.setdefault(REFERENCIA or primero[genero], []).append(pieza)
        for pieza, imagen, _ in miniaturas_piezas(manifest, manifest["piezas"], grupos):
            hoja_piezas.append(imagen)

    # marca las miniaturas existentes en el catálogo
    ruta_manifest = os.path.join(vista.MODULAR, "manifest.json")
    for cuerpo in manifest["cuerpos"]:
        if os.path.isfile(os.path.join(SALIDA, "cuerpos", cuerpo["id"] + ".png")):
            cuerpo["miniatura"] = True
    for pieza in manifest["piezas"]:
        if os.path.isfile(os.path.join(SALIDA, pieza["slot"], pieza["id"] + ".png")):
            pieza["miniatura"] = True
    if os.path.abspath(SALIDA) == os.path.abspath(os.path.join(vista.MODULAR, "miniaturas")):
        with open(ruta_manifest, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, ensure_ascii=False, indent=2)
        log("manifest actualizado")

    if HOJA:
        bloques = []
        if hoja_cuerpos:
            bloques.append(vista.componer_hoja(hoja_cuerpos, 10))
        if hoja_piezas:
            bloques.append(vista.componer_hoja(hoja_piezas, 13))
        ancho = max(b.shape[1] for b in bloques)
        relleno = [np.pad(b, ((0, 0), (0, ancho - b.shape[1]), (0, 0)), mode="edge") for b in bloques]
        vista.guardar_array(os.path.abspath(HOJA), np.concatenate(relleno, axis=0))
        log("hoja guardada en " + HOJA)


main()
