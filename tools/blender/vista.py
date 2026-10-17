"""Utilidades de render compartidas por previsualizar_todos.py y miniaturas.py (no se ejecuta solo).

Monta en una escena de Blender un cuerpo del catálogo modular con las piezas que se quiera, importando
sus .glb, y lo dibuja con las mismas luces suaves que previsualizar_glb.py.
"""
import json
import math
import os
import struct
import zlib

import bpy
import numpy as np
from mathutils import Vector

ROOT = os.getcwd()
MODULAR = os.environ.get("SALIDA_DIR") or os.path.join(ROOT, "public", "models", "modular")
FONDO = (0.09, 0.11, 0.1)          # color del cielo (luz ambiental suave), no el fondo de la imagen
FONDO_OSCURO = (0x1A, 0x22, 0x1E)  # #1A221E, fondo liso opcional de las miniaturas


def cargar_manifest():
    with open(os.path.join(MODULAR, "manifest.json"), encoding="utf-8") as handle:
        return json.load(handle)


# ---------------------------------------------------------------------------------------- escena
def limpiar():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for datablock in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures):
        for item in list(datablock):
            if item.users == 0:
                datablock.remove(item)


def importar(glb):
    """Importa un .glb y devuelve sus objetos (sin las esferas auxiliares que dibujan los huesos)."""
    antes = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    nuevos = [o for o in bpy.data.objects if o not in antes]
    utiles = []
    for obj in nuevos:
        if obj.type == "MESH" and obj.name.startswith("Icosphere"):
            bpy.data.objects.remove(obj, do_unlink=True)
        else:
            utiles.append(obj)
    return utiles


def meshes(objetos):
    return [o for o in objetos if o.type == "MESH"]


def montar(cuerpo, piezas, manifest=None, sin_defecto=False):
    """Importa body.glb y las piezas ({hueco: id}) de un cuerpo. Devuelve {"cuerpo": [...], hueco: [...]}."""
    resultado = {"cuerpo": importar(os.path.join(MODULAR, cuerpo, "body.glb"))}
    por_id = {p["id"]: p for p in (manifest or cargar_manifest())["piezas"]}
    for hueco, pieza in piezas.items():
        if pieza:
            resultado[hueco] = importar(os.path.join(MODULAR, cuerpo, hueco, pieza + ".glb"))
            if not sin_defecto:
                tenir_defecto(resultado[hueco], por_id.get(pieza))
    return resultado


def defecto_con_ocultas(entrada, manifest):
    """Piezas por defecto de un cuerpo respetando que el conjunto sustituye a torso+piernas y la gorra al pelo."""
    piezas = dict(entrada["defecto"])
    por_id = {p["id"]: p for p in manifest["piezas"]}
    for pieza in list(piezas.values()):
        for oculto in por_id[pieza].get("oculta", []):
            piezas.pop(oculto, None)
    if "conjunto" in piezas:
        piezas.pop("torso", None)
        piezas.pop("piernas", None)
    return piezas


# ---------------------------------------------------------------------------------- materiales
def srgb_a_lineal(valor):
    return valor / 12.92 if valor <= 0.04045 else ((valor + 0.055) / 1.055) ** 2.4


def hex_a_lineal(texto):
    texto = texto.lstrip("#")
    return [srgb_a_lineal(int(texto[i:i + 2], 16) / 255) for i in (0, 2, 4)]


def tenir_pelo(objetos, color_hex):
    """Mismo teñido que el navegador: color * luminosidad de la textura / 0,08, entre 0,35 y 2,4."""
    tinte = hex_a_lineal(color_hex)
    for obj in meshes(objetos):
        for slot in obj.material_slots:
            material = slot.material
            if not material or not material.node_tree:
                continue
            nodos, enlaces = material.node_tree.nodes, material.node_tree.links
            bsdf = next((n for n in nodos if n.type == "BSDF_PRINCIPLED"), None)
            if not bsdf or not bsdf.inputs["Base Color"].links:
                continue
            origen = bsdf.inputs["Base Color"].links[0].from_socket
            bn = nodos.new("ShaderNodeRGBToBW")
            dividir = nodos.new("ShaderNodeMath")
            dividir.operation = "DIVIDE"
            dividir.inputs[1].default_value = 0.08
            limite = nodos.new("ShaderNodeClamp")
            limite.inputs["Min"].default_value = 0.35
            limite.inputs["Max"].default_value = 2.4
            escalar = nodos.new("ShaderNodeVectorMath")
            escalar.operation = "SCALE"
            escalar.inputs[0].default_value = (tinte[0], tinte[1], tinte[2])
            enlaces.new(origen, bn.inputs["Color"])
            enlaces.new(bn.outputs["Val"], dividir.inputs[0])
            enlaces.new(dividir.outputs[0], limite.inputs["Value"])
            enlaces.new(limite.outputs["Result"], escalar.inputs["Scale"])
            enlaces.new(escalar.outputs["Vector"], bsdf.inputs["Base Color"])


def tenir_prenda(objetos, color_hex):
    """Mismo teñido que el navegador para ropa y gorras ("tinte"): textura difusa multiplicada por el color (material.color)."""
    tinte = hex_a_lineal(color_hex)
    for obj in meshes(objetos):
        for slot in obj.material_slots:
            material = slot.material
            if not material or not material.node_tree:
                continue
            nodos, enlaces = material.node_tree.nodes, material.node_tree.links
            bsdf = next((n for n in nodos if n.type == "BSDF_PRINCIPLED"), None)
            if not bsdf or not bsdf.inputs["Base Color"].links:
                continue
            origen = bsdf.inputs["Base Color"].links[0].from_socket
            mezcla = nodos.new("ShaderNodeMix")
            mezcla.data_type = "RGBA"
            mezcla.blend_type = "MULTIPLY"
            mezcla.inputs[0].default_value = 1.0
            mezcla.inputs[7].default_value = (tinte[0], tinte[1], tinte[2], 1)
            enlaces.new(origen, mezcla.inputs[6])
            enlaces.new(mezcla.outputs[2], bsdf.inputs["Base Color"])


def tenir_defecto(objetos, pieza):
    """Si la pieza lleva "colorDefecto" (telas desaturadas, que sin teñir salen grises), la tiñe con ese color."""
    if pieza and pieza.get("colorDefecto"):
        tenir_prenda(objetos, pieza["colorDefecto"])


def maniqui(objetos, gris=0.16):
    """Pinta de gris liso el cuerpo (el mayor de los objetos) y oculta ojos, cejas y pestañas."""
    todos = meshes(objetos)
    if not todos:
        return
    piel = max(todos, key=lambda o: len(o.data.vertices))
    material = bpy.data.materials.new("maniqui")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (gris, gris * 1.02, gris * 0.98, 1)
    bsdf.inputs["Roughness"].default_value = 0.75
    for obj in todos:
        if obj is piel:
            obj.data.materials.clear()
            obj.data.materials.append(material)
        else:
            obj.hide_render = True


# ------------------------------------------------------------------------------------------ pose
def bajar_brazos(objetos):
    """Baja los brazos de la pose en A a una postura natural (como hace el navegador)."""
    for arm in [o for o in objetos if o.type == "ARMATURE"]:
        pose = arm.pose
        bpy.context.view_layer.update()
        for lado in ("l", "r"):
            nombres = ("upperarm_" + lado, "lowerarm_" + lado)
            if not all(n in pose.bones for n in nombres):
                continue
            hacia = 1 if (arm.matrix_world @ pose.bones[nombres[1]].head).x > (
                arm.matrix_world @ pose.bones[nombres[0]].head).x else -1
            objetivos = {nombres[0]: Vector((hacia * 0.2, -0.02, -1)), nombres[1]: Vector((hacia * 0.14, -0.3, -1))}
            for nombre in nombres:
                hueso = pose.bones[nombre]
                bpy.context.view_layer.update()
                cabeza = arm.matrix_world @ hueso.head
                cola = arm.matrix_world @ hueso.tail
                giro = (cola - cabeza).normalized().rotation_difference(objetivos[nombre].normalized())
                m_mundo = arm.matrix_world @ hueso.matrix
                loc = m_mundo.to_translation()
                nuevo = giro.to_matrix().to_4x4() @ m_mundo.to_3x3().to_4x4()
                nuevo.translation = loc
                hueso.matrix = arm.matrix_world.inverted() @ nuevo
        bpy.context.view_layer.update()


# ---------------------------------------------------------------------------------------- medidas
def limites(objetos):
    """(x_min, x_max, z_min, z_max) de los objetos con malla."""
    xs, zs = [], []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in meshes(objetos):
        evaluado = obj.evaluated_get(depsgraph)
        for esquina in evaluado.bound_box:
            punto = obj.matrix_world @ Vector(esquina)
            xs.append(punto.x)
            zs.append(punto.z)
    return min(xs), max(xs), min(zs), max(zs)


# ----------------------------------------------------------------------------------------- render
def preparar(ancho, alto, muestras=24, transparente=False, vista="Standard"):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = muestras
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = ancho, alto
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = transparente
    scene.view_settings.view_transform = vista
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if transparente else "RGB"
    mundo = bpy.data.worlds.new("w")
    mundo.use_nodes = True
    mundo.node_tree.nodes["Background"].inputs[0].default_value = (*FONDO, 1)
    mundo.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = mundo
    return scene


def luces(objetivo, escala=1.0):
    scene = bpy.context.scene
    for obj in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    for nombre, pos, energia in (("key", (-2.5, -3, 3), 450), ("fill", (3, -2, 1.5), 180), ("rim", (0, 3, 3), 300)):
        datos = bpy.data.lights.new(nombre, "AREA")
        datos.energy, datos.size = energia * escala, 2
        luz = bpy.data.objects.new(nombre, datos)
        luz.location = Vector(pos) + Vector((0, 0, objetivo.z - 1.0))
        scene.collection.objects.link(luz)
        luz.rotation_euler = (objetivo - luz.location).to_track_quat("-Z", "Y").to_euler()


def camara(centro, alto_visible, azimut=0.0, elevacion=0.0, lente=85.0):
    """Cámara que mira a `centro` (Vector) y deja `alto_visible` metros en vertical. Azimut y elevación en grados."""
    scene = bpy.context.scene
    for obj in [o for o in bpy.data.objects if o.type == "CAMERA"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    datos = bpy.data.cameras.new("cam")
    datos.lens = lente
    datos.sensor_fit = "VERTICAL"
    datos.sensor_height = 36
    cam = bpy.data.objects.new("cam", datos)
    scene.collection.objects.link(cam)
    scene.camera = cam
    distancia = (alto_visible / 2) * lente / 18
    az, el = math.radians(azimut), math.radians(elevacion)
    # el glTF importado mira hacia -Y de Blender: la cámara va delante, en -Y
    cam.location = centro + Vector((
        math.sin(az) * math.cos(el) * distancia,
        -math.cos(az) * math.cos(el) * distancia,
        math.sin(el) * distancia,
    ))
    cam.rotation_euler = (centro - cam.location).to_track_quat("-Z", "Y").to_euler()
    return cam


def renderizar(ruta_png):
    bpy.context.scene.render.filepath = ruta_png
    bpy.ops.render.render(write_still=True)


def leer_png(ruta):
    """Lee un PNG como matriz (alto, ancho, 4) de bytes, de arriba hacia abajo."""
    imagen = bpy.data.images.load(ruta)
    imagen.colorspace_settings.name = "Non-Color"
    ancho, alto = imagen.size
    datos = np.array(imagen.pixels[:], dtype=np.float32).reshape(alto, ancho, 4)
    bpy.data.images.remove(imagen)
    return np.clip(np.rint(datos[::-1] * 255), 0, 255).astype(np.uint8)


# ------------------------------------------------------------------------------- PNG cuantizado
def _paleta(pixeles, cantidad):
    """Paleta de hasta `cantidad` colores RGBA por corte mediano y unas vueltas de k-medias."""
    unicos, cuentas = np.unique(pixeles, axis=0, return_counts=True)
    unicos = unicos.astype(np.float32)
    cajas = [(unicos, cuentas.astype(np.float32))]
    while len(cajas) < cantidad:
        # la caja con más "error" (rango x peso) se parte por su mediana en el canal más ancho
        mejor, mejor_valor = None, 0.0
        for i, (colores, pesos) in enumerate(cajas):
            if len(colores) < 2:
                continue
            rango = colores.max(0) - colores.min(0)
            valor = float(rango.max() * pesos.sum())
            if valor > mejor_valor:
                mejor, mejor_valor = i, valor
        if mejor is None:
            break
        colores, pesos = cajas.pop(mejor)
        canal = int(np.argmax(colores.max(0) - colores.min(0)))
        orden = np.argsort(colores[:, canal])
        colores, pesos = colores[orden], pesos[orden]
        corte = int(np.searchsorted(np.cumsum(pesos), pesos.sum() / 2))
        corte = min(max(corte, 1), len(colores) - 1)
        cajas.append((colores[:corte], pesos[:corte]))
        cajas.append((colores[corte:], pesos[corte:]))
    paleta = np.array([(c * p[:, None]).sum(0) / p.sum() for c, p in cajas], dtype=np.float32)
    for _ in range(3):
        indices = _asignar(unicos, paleta)
        for k in range(len(paleta)):
            seleccion = indices == k
            if seleccion.any():
                paleta[k] = (unicos[seleccion] * cuentas[seleccion, None]).sum(0) / cuentas[seleccion].sum()
    return paleta


def _asignar(colores, paleta):
    resultado = np.empty(len(colores), dtype=np.int32)
    for inicio in range(0, len(colores), 4096):
        parte = colores[inicio:inicio + 4096, None, :] - paleta[None, :, :]
        resultado[inicio:inicio + 4096] = np.argmin((parte * parte).sum(-1), axis=1)
    return resultado


def guardar_png8(ruta, rgba, colores=255):
    """Guarda `rgba` (alto, ancho, 4 bytes) como PNG de paleta con transparencia. Devuelve el tamaño en bytes."""
    alto, ancho, _ = rgba.shape
    planos = rgba.reshape(-1, 4).copy()
    planos[planos[:, 3] == 0, :3] = 0
    paleta = _paleta(planos, colores)
    indices = np.empty(len(planos), dtype=np.int32)
    unicos, inverso = np.unique(planos, axis=0, return_inverse=True)
    indices = _asignar(unicos.astype(np.float32), paleta)[inverso.reshape(-1)]
    imagen = indices.reshape(alto, ancho).astype(np.uint8)
    paleta_b = np.clip(np.rint(paleta), 0, 255).astype(np.uint8)

    def trozo(tipo, datos):
        crc = zlib.crc32(tipo + datos) & 0xFFFFFFFF
        return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", crc)

    mejor = None
    for filtro in (0, 1, 2):
        if filtro == 0:
            filas = imagen
        elif filtro == 1:
            filas = np.diff(imagen.astype(np.int16), axis=1, prepend=0).astype(np.uint8)
        else:
            filas = np.diff(imagen.astype(np.int16), axis=0, prepend=0).astype(np.uint8)
        crudo = b"".join(bytes([filtro]) + filas[y].tobytes() for y in range(alto))
        comprimido = zlib.compress(crudo, 9)
        if mejor is None or len(comprimido) < len(mejor):
            mejor = comprimido
    contenido = b"\x89PNG\r\n\x1a\n"
    contenido += trozo(b"IHDR", struct.pack(">IIBBBBB", ancho, alto, 8, 3, 0, 0, 0))
    contenido += trozo(b"PLTE", paleta_b[:, :3].tobytes())
    contenido += trozo(b"tRNS", paleta_b[:, 3].tobytes())
    contenido += trozo(b"IDAT", mejor)
    contenido += trozo(b"IEND", b"")
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, "wb") as handle:
        handle.write(contenido)
    return len(contenido)


def componer_hoja(mosaicos, columnas, fondo=(0.09, 0.11, 0.1)):
    """Junta mosaicos RGBA (matrices de bytes, pueden tener distinto tamaño) en una hoja con fondo liso."""
    columnas = min(columnas, len(mosaicos))
    alto = max(m.shape[0] for m in mosaicos)
    ancho = max(m.shape[1] for m in mosaicos)
    filas = (len(mosaicos) + columnas - 1) // columnas
    hoja = np.zeros((filas * alto, columnas * ancho, 4), dtype=np.float32)
    hoja[..., :3] = fondo
    hoja[..., 3] = 1
    for i, mosaico in enumerate(mosaicos):
        f, c = divmod(i, columnas)
        h, w = mosaico.shape[:2]
        y0, x0 = f * alto + (alto - h) // 2, c * ancho + (ancho - w) // 2
        pix = mosaico.astype(np.float32) / 255
        alfa = pix[..., 3:4]
        trozo = hoja[y0:y0 + h, x0:x0 + w]
        trozo[..., :3] = pix[..., :3] * alfa + trozo[..., :3] * (1 - alfa)
    return hoja


def guardar_hoja(ruta, mosaicos, columnas, fondo=(0.09, 0.11, 0.1)):
    guardar_array(ruta, componer_hoja(mosaicos, columnas, fondo))


def guardar_array(ruta, hoja):
    """Guarda una matriz float (alto, ancho, 4) de arriba hacia abajo como PNG."""
    alto, ancho = hoja.shape[:2]
    imagen = bpy.data.images.new("hoja", ancho, alto, alpha=True)
    imagen.colorspace_settings.name = "Non-Color"
    imagen.pixels = hoja[::-1].flatten().tolist()
    imagen.filepath_raw = ruta
    imagen.file_format = "PNG"
    imagen.save()
    bpy.data.images.remove(imagen)