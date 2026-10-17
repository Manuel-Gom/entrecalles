"""Exporta cuerpos y piezas (pelo, ropa, calzado, gorras) por separado para poder combinarlos en el navegador.

Uso (desde la raíz del proyecto):
  blender.exe --background --python tools/blender/crear_modular.py -- [id_cuerpo ...]

Lee tools/blender/piezas.json y tools/blender/personajes.json. Cada cuerpo tiene "genero" ("hombre" o
"mujer") y cada pieza "para" (lista de géneros); solo se exporta cada pieza para los cuerpos compatibles.
Salida:
  public/models/modular/<cuerpo>/body.glb
  public/models/modular/<cuerpo>/<hueco>/<pieza>.glb
  public/models/modular/manifest.json   (cuerpos con "genero", piezas con "para" y "miniatura" si hay PNG)

Cada pieza se ajusta a las medidas de su cuerpo y comparte el mismo esqueleto.
"""
import json
import os
import shutil
import sys
import traceback

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crear_personajes as cp  # noqa: E402

from bl_ext.blender_org.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.blender_org.mpfb.services.exportservice import ExportService  # noqa: E402
from bl_ext.blender_org.mpfb.services.objectservice import ObjectService  # noqa: E402
from bl_ext.blender_org.mpfb.services.materialservice import MaterialService  # noqa: E402
from bl_ext.blender_org.mpfb.entities.material.mhmaterial import MhMaterial  # noqa: E402
from bl_ext.blender_org.mpfb.entities.nodemodel.v2.materials.nodewrappergameengine import NodeWrapperGameEngine  # noqa: E402

PIEZAS = os.environ.get("PIEZAS_JSON") or os.path.join(cp.ROOT, "tools", "blender", "piezas.json")
OUT = os.environ.get("SALIDA_DIR") or os.path.join(cp.ROOT, "public", "models", "modular")
# Los pies solo se ocultan donde los cubre un zapato bajo. Con botas o zapatillas altas se ve igual
# porque el calzado cubre la zona; el calzado es obligatorio en el editor.
FEET_MASK = ("shoes01",)
SIN_INFLAR = ("barba", "gafas")   # huecos cuyas piezas siguen la cara tal cual, sin separarse del cuerpo
GENDER_VALUE = {"hombre": 1.0, "mujer": 0.0}   # macro.gender de MPFB: 0 = mujer, 1 = hombre


def log(msg):
    print("[modular]", msg, flush=True)


def export_subset(root, objects, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_image_format="WEBP",
        export_image_quality=80,
        export_meshopt_compression_enable=True,
    )
    return os.path.getsize(path) / 1048576


def make_feet(copy_base):
    """Copia del cuerpo que conserva SOLO la zona que se borra bajo el calzado alto (pies y tobillos)."""
    feet = copy_base.copy()
    feet.data = copy_base.data.copy()
    feet.name = "Human.pies_export_copy"
    for collection in copy_base.users_collection:
        collection.objects.link(feet)
    for modifier in feet.modifiers:
        group = (modifier.vertex_group or "").lower()
        if modifier.type == "MASK" and group.startswith("delete.") and any(w in group for w in FEET_MASK):
            modifier.invert_vertex_group = False  # el borrado de MPFB va invertido: sin invertir solo queda la zona
    return feet


def cap_textures(obj, size):
    """Reduce las texturas de una pieza a como mucho `size` píxeles (piezas pequeñas que pesarían demasiado)."""
    for slot in obj.material_slots:
        if not slot.material or not slot.material.node_tree:
            continue
        for node in slot.material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                width, height = node.image.size
                factor = size / max(width, height)
                if factor < 1:
                    node.image.scale(max(1, int(width * factor)), max(1, int(height * factor)))


def ajustar_imagenes(obj, brillo=None, lente=None):
    """Retoca una copia de las texturas de una pieza antes de exportarla.

    brillo: multiplica el color (valores sRGB de la textura). Las barbas se tiñen en el navegador como el pelo
            (color x luminosidad de la textura / 0,08), así que su textura debe tener una luminosidad parecida a la del pelo.
    lente: multiplica la opacidad de los píxeles casi transparentes (lentes de las gafas, alfa < 0,5).
    """
    import numpy as np
    for slot in obj.material_slots:
        if not slot.material or not slot.material.node_tree:
            continue
        for node in slot.material.node_tree.nodes:
            if node.type != "TEX_IMAGE" or not node.image:
                continue
            _copiar_imagen(node)
            pixeles = np.empty(len(node.image.pixels), dtype=np.float32)
            node.image.pixels.foreach_get(pixeles)
            pixeles = pixeles.reshape(-1, 4)
            if brillo:
                pixeles[:, :3] *= brillo
            if lente:
                lentes = pixeles[:, 3] < 0.5
                pixeles[lentes, 3] *= lente
            node.image.pixels.foreach_set(pixeles.reshape(-1))
            node.image.update()


def _a_lineal(valor):
    return np.where(valor <= 0.04045, valor / 12.92, ((valor + 0.055) / 1.055) ** 2.4)


def _a_srgb(valor):
    valor = np.clip(valor, 0.0, 1.0)
    return np.where(valor <= 0.0031308, valor * 12.92, 1.055 * valor ** (1 / 2.4) - 0.055)


def _imagenes_color_base(material):
    """Nodos de imagen que alimentan el Base Color (no las normales ni otros mapas)."""
    bsdf = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf or not bsdf.inputs["Base Color"].links:
        return []
    encontrados, pendientes, vistos = [], [bsdf.inputs["Base Color"].links[0].from_node], set()
    while pendientes:
        nodo = pendientes.pop()
        if nodo.name in vistos:
            continue
        vistos.add(nodo.name)
        if nodo.type == "TEX_IMAGE" and nodo.image:
            encontrados.append(nodo)
        for entrada in nodo.inputs:
            for enlace in entrada.links:
                pendientes.append(enlace.from_node)
    return encontrados


def _copiar_imagen(nodo):
    """Sustituye la imagen del nodo por una copia editable del mismo tamaño (copy() puede recargar el archivo original)."""
    tamano = tuple(nodo.image.size)
    nodo.image = nodo.image.copy()
    if tuple(nodo.image.size) != tamano:
        nodo.image.scale(*tamano)


def _muestras_uv(obj, nodo_imagen):
    """Índices de píxel (fila, columna) en el centro de cada triángulo de la malla y su área (para ponderar la media)."""
    malla = obj.data
    capa = malla.uv_layers.active
    if capa is None:
        return None
    malla.calc_loop_triangles()
    ancho, alto = nodo_imagen.image.size
    uv = np.empty(len(malla.loops) * 2, dtype=np.float32)
    capa.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    triangulos = np.empty(len(malla.loop_triangles) * 3, dtype=np.int32)
    malla.loop_triangles.foreach_get("loops", triangulos)
    triangulos = triangulos.reshape(-1, 3)
    puntos = uv[triangulos]                       # (n, 3, 2)
    centro = puntos.mean(axis=1)
    a, b = puntos[:, 1] - puntos[:, 0], puntos[:, 2] - puntos[:, 0]
    area = np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]) / 2
    columna = np.clip((centro[:, 0] % 1.0) * ancho, 0, ancho - 1).astype(np.int32)
    fila = np.clip((centro[:, 1] % 1.0) * alto, 0, alto - 1).astype(np.int32)
    return fila, columna, area


def desaturar_imagenes(obj, objetivo=0.68, gamma=None, brillo=None):
    """Convierte la textura de color de una pieza a gris claro conservando el relieve (luminancia).

    El navegador tiñe multiplicando la textura por un color: con una tela roja u oscura, el azul sale morado o negro.
    Se calcula la luminancia lineal, se normaliza para que su media (ponderada por el área de la malla que usa cada
    zona de la textura) sea `objetivo`, se comprimen suavemente las luces para que el blanco no se queme y se
    guarda como gris. `gamma` (<1 aclara las sombras del relieve) y `brillo` (multiplicador final) son opcionales.
    """
    hechos = set()
    for slot in obj.material_slots:
        if not slot.material or not slot.material.node_tree:
            continue
        for nodo in _imagenes_color_base(slot.material):
            if nodo.name in hechos:
                continue
            hechos.add(nodo.name)
            muestras = _muestras_uv(obj, nodo)
            _copiar_imagen(nodo)
            ancho, alto = nodo.image.size
            pixeles = np.empty(len(nodo.image.pixels), dtype=np.float32)
            nodo.image.pixels.foreach_get(pixeles)
            pixeles = pixeles.reshape(-1, 4)
            lineal = _a_lineal(pixeles[:, :3])
            lum = lineal @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
            if muestras is not None:
                fila, columna, area = muestras
                valores = lum[fila * ancho + columna]
                media = float((valores * area).sum() / max(area.sum(), 1e-9))
                rgb = (lineal[fila * ancho + columna] * area[:, None]).sum(0) / max(area.sum(), 1e-9)
            else:
                media = float(lum.mean())
                rgb = lineal.mean(0)
            original = _a_srgb(np.clip(rgb / objetivo, 0, 1))   # tinte que devuelve el color medio original
            log("color original %s: #%02x%02x%02x" % ((obj.name,) + tuple(int(round(v * 255)) for v in original)))
            lum = lum * (objetivo / max(media, 1e-4))
            if gamma:
                lum = np.clip(lum, 0, None) ** gamma
            if brillo:
                lum = lum * brillo
            codo = 0.8   # por encima del codo las luces se comprimen hacia 1 sin cortarlas de golpe
            lum = np.where(lum > codo, codo + (1 - codo) * np.tanh((lum - codo) / (1 - codo)), lum)
            gris = _a_srgb(lum)
            pixeles[:, :3] = gris[:, None]
            nodo.image.pixels.foreach_set(pixeles.reshape(-1))
            nodo.image.update()
            log("desaturada %s: media lineal %.3f -> %.2f" % (nodo.image.name, media, objetivo))


def volver_mate(obj, rugosidad):
    """Quita el brillo de plástico: MPFB convierte un shininess alto en rugosidad baja y un mapa de especular.
    Se desconecta la rugosidad y el especular de sus texturas y se fija un valor liso (tela mate)."""
    for slot in obj.material_slots:
        if not slot.material or not slot.material.node_tree:
            continue
        arbol = slot.material.node_tree
        bsdf = next((n for n in arbol.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        for nombre in ("Roughness", "Metallic", "Specular IOR Level"):
            entrada = bsdf.inputs.get(nombre)
            if entrada is None:
                continue
            for enlace in list(entrada.links):
                arbol.links.remove(enlace)
        bsdf.inputs["Roughness"].default_value = rugosidad
        bsdf.inputs["Metallic"].default_value = 0.0
        if bsdf.inputs.get("Specular IOR Level") is not None:
            bsdf.inputs["Specular IOR Level"].default_value = 0.25


def quitar_logo(obj, cfg):
    """Tapa el logotipo de MakeHuman de la textura (copia retocada, el original de MPFB no se toca).

    cfg: {"zona": [x0, y0, x1, y1], "desde": [dx, dy]}, fracciones del ancho y el alto de la textura con el origen
    arriba a la izquierda. El rectángulo `zona` se sustituye por el trozo de tela lisa desplazado (dx, dy), así que
    conserva el grano de la tela.
    """
    hechos = set()
    for slot in obj.material_slots:
        if not slot.material or not slot.material.node_tree:
            continue
        for nodo in _imagenes_color_base(slot.material):
            if nodo.name in hechos:
                continue
            hechos.add(nodo.name)
            _copiar_imagen(nodo)
            ancho, alto = nodo.image.size
            pixeles = np.empty(len(nodo.image.pixels), dtype=np.float32)
            nodo.image.pixels.foreach_get(pixeles)
            imagen = pixeles.reshape(alto, ancho, 4)[::-1]   # la fila 0 pasa a ser la de arriba
            x0, y0, x1, y1 = [int(round(v * (ancho if i % 2 == 0 else alto))) for i, v in enumerate(cfg["zona"])]
            dx, dy = int(round(cfg["desde"][0] * ancho)), int(round(cfg["desde"][1] * alto))
            imagen[y0:y1, x0:x1] = imagen[y0 + dy:y1 + dy, x0 + dx:x1 + dx].copy()
            nodo.image.pixels.foreach_set(pixeles)
            nodo.image.update()


def feet_above(feet, shoe):
    """Copia de los pies solo por encima del borde del calzado cerrado (botines): los dedos no atraviesan la bota."""
    cut = feet.copy()
    cut.data = feet.data.copy()
    cut.name = "Human.tobillo_export_copy"
    for collection in feet.users_collection:
        collection.objects.link(cut)
    z_cut = max((shoe.matrix_world @ v.co).z for v in shoe.data.vertices) - 0.03
    mesh = bmesh.new()
    mesh.from_mesh(cut.data)
    bmesh.ops.delete(mesh, geom=[v for v in mesh.verts if (cut.matrix_world @ v.co).z < z_cut], context="VERTS")
    mesh.to_mesh(cut.data)
    mesh.free()
    return cut


def shrink_feet_material(feet, size=512):
    """El pie se ve pequeño: usa su propia copia de la piel a baja resolución para que la pieza pese poco."""
    for slot in feet.material_slots:
        material = slot.material.copy()
        slot.material = material
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                node.image = node.image.copy()
                width, height = node.image.size
                factor = size / max(width, height)
                if factor < 1:
                    node.image.scale(max(1, int(width * factor)), max(1, int(height * factor)))


def build_body(defaults, spec, pieces):
    cp.clear_scene()
    macro = {
        "gender": GENDER_VALUE[spec.get("genero", "hombre")], "age": 0.5, "muscle": 0.5, "weight": 0.5, "proportions": 0.5,
        "height": 0.5, "cupsize": 0.5, "firmness": 0.5,
        "race": spec["macro"]["race"],
    }
    macro.update({k: v for k, v in spec["macro"].items() if k != "race"})
    basemesh = HumanService.create_human(macro_detail_dict=macro)
    rig = HumanService.add_builtin_rig(basemesh, defaults["rig"])
    HumanService.set_character_skin(
        os.path.join(cp.USER_DATA, "skins", spec["skin"], spec["skin"] + ".mhmat"),
        basemesh, skin_type="GAMEENGINE",
    )

    def add(kind, folder, name, material=None):
        path = cp.find_asset(folder, name)
        obj = HumanService.add_mhclo_asset(
            path, basemesh, asset_type=kind,
            subdiv_levels=0, material_type="GAMEENGINE",
        )
        if material and not obj.material_slots:
            # algunos .mhclo no enlazan su material (la gorra sale blanca): se indica con "material" en piezas.json
            material_nuevo = MaterialService.create_empty_material(obj.name, obj)
            mhmat = MhMaterial()
            mhmat.populate_from_mhmat(os.path.join(os.path.dirname(path), material))
            NodeWrapperGameEngine.create_instance(material_nuevo.node_tree, mhmat=mhmat)
        return obj

    base_parts = [
        add("eyes", "eyes", defaults["eyes"]),
        add("eyebrows", "eyebrows", defaults["eyebrows"]),
        add("eyelashes", "eyelashes", defaults["eyelashes"]),
    ]
    piece_objects = {}
    for piece in pieces:
        folder = "hair" if piece["tipo"] == "hair" else "clothes"
        piece_objects[piece["id"]] = add(piece["tipo"], folder, piece["id"], piece.get("material"))

    root = ExportService.create_character_copy(rig or basemesh)
    copy_base = ObjectService.find_object_of_type_amongst_nearest_relatives(root)
    cp.keep_body_under_clothes(copy_base, FEET_MASK)
    # Calzado bajo (bailarinas, botines): deja ver el pie y el tobillo. El cuerpo no los tiene (se borran bajo
    # el calzado alto), así que esas piezas llevan además una copia de esa zona del cuerpo ("pies": true).
    copy_feet = make_feet(copy_base) if any(p.get("pies") for p in pieces) else None
    for obj in [copy_base] + ([copy_feet] if copy_feet else []):
        ExportService.bake_modifiers_remove_helpers(
            obj, bake_masks=True, bake_subdiv=True, remove_helpers=True,
        )
    children = [c for c in ObjectService.get_list_of_children(root) if c is not copy_feet]
    by_name = {child.name: child for child in children}

    def copy_of(obj):
        wanted = obj.name + "_export_copy"
        if wanted in by_name:
            return by_name[wanted]
        for name, child in by_name.items():
            if name.startswith(obj.name):
                return child
        raise KeyError("No se encuentra la copia de " + obj.name)

    piece_copies = {pid: copy_of(o) for pid, o in piece_objects.items()}
    # ni el pelo ni la barba ni las gafas se inflan: solo las capas de ropa se separan del cuerpo
    sin_inflar = {piece_copies[p["id"]] for p in pieces if p["tipo"] == "hair" or p["slot"] in SIN_INFLAR}
    cp.inflate_layers([c for c in children if c not in sin_inflar], {"clothes": []})
    cp.shrink_textures(children)
    for piece in pieces:
        if piece.get("textura"):
            cap_textures(piece_copies[piece["id"]], piece["textura"])
        if piece.get("mate"):
            volver_mate(piece_copies[piece["id"]], piece["mate"])
        if piece.get("sin_logo"):
            quitar_logo(piece_copies[piece["id"]], piece["sin_logo"])
        if piece.get("desaturar"):
            desaturar_imagenes(piece_copies[piece["id"]], gamma=piece.get("gamma"), brillo=piece.get("brillo"))
        elif piece.get("brillo") or piece.get("lente"):
            ajustar_imagenes(piece_copies[piece["id"]], piece.get("brillo"), piece.get("lente"))
    if copy_feet:
        shrink_feet_material(copy_feet)
    return root, copy_base, [copy_of(o) for o in base_parts], piece_copies, copy_feet


def manifest_piece(piece, has_thumb):
    entry = {k: v for k, v in piece.items() if k not in ("tipo", "pies", "textura", "brillo", "lente", "material", "desaturar", "gamma", "sin_logo", "mate")}
    if has_thumb(piece["slot"], piece["id"] + ".png"):
        entry["miniatura"] = True
    return entry


def main():
    with open(PIEZAS, encoding="utf-8") as handle:
        catalog = json.load(handle)
    with open(cp.CONFIG, encoding="utf-8") as handle:
        config = json.load(handle)
    wanted = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else catalog["cuerpos"]
    specs = {p["id"]: p for p in config["personajes"]}
    slot_of = {p["id"]: p["slot"] for p in catalog["piezas"]}

    def has_thumb(*parts):
        return os.path.isfile(os.path.join(OUT, "miniaturas", *parts))

    manifest_bodies = []
    for body_id in catalog["cuerpos"]:
        spec = specs[body_id]
        gender = spec.get("genero", "hombre")
        defaults = {slot: None for slot in catalog["huecos"]}
        for item in spec["clothes"]:
            if item in slot_of:
                defaults[slot_of[item]] = item
        if spec.get("hair") in slot_of:
            defaults["pelo"] = spec["hair"]
        entry = {
            "id": body_id, "nombre": spec["nombre"], "genero": gender, "descripcion": spec["descripcion"],
            "defecto": {k: v for k, v in defaults.items() if v},
        }
        if spec.get("color_pelo"):
            entry["colorPelo"] = spec["color_pelo"]
        if has_thumb("cuerpos", body_id + ".png"):
            entry["miniatura"] = True
        manifest_bodies.append(entry)
        if body_id not in wanted:
            continue
        log("== cuerpo %s (%s) ==" % (body_id, gender))
        compatible = [p for p in catalog["piezas"] if gender in p["para"]]
        only = os.environ.get("SOLO_PIEZAS")  # solo para pruebas: ids separados por comas
        if only:
            to_export = [p for p in compatible if p["id"] in only.split(",")]
        else:
            to_export = compatible
            shutil.rmtree(os.path.join(OUT, body_id), ignore_errors=True)  # sin restos de piezas retiradas
        try:
            root, copy_base, base_parts, piece_objects, copy_feet = build_body(config["defaults"], spec, to_export)
            mb = export_subset(root, [copy_base] + base_parts, os.path.join(OUT, body_id, "body.glb"))
            log("%s/body.glb %.2f MB" % (body_id, mb))
            for piece in to_export:
                extra = []
                if piece.get("pies") == "tobillo":
                    extra = [feet_above(copy_feet, piece_objects[piece["id"]])]
                elif piece.get("pies"):
                    extra = [copy_feet]
                mb = export_subset(root, [piece_objects[piece["id"]]] + extra,
                                   os.path.join(OUT, body_id, piece["slot"], piece["id"] + ".glb"))
                if piece.get("pies") == "tobillo":
                    bpy.data.objects.remove(extra[0], do_unlink=True)
                log("%s/%s/%s.glb %.2f MB" % (body_id, piece["slot"], piece["id"], mb))
        except Exception:
            traceback.print_exc()

    manifest = {
        "cuerpos": manifest_bodies,
        "huecos": catalog["huecos"],
        "piezas": [manifest_piece(piece, has_thumb) for piece in catalog["piezas"]],
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
    log("manifest escrito")


if __name__ == "__main__":
    main()
