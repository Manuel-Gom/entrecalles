"""Crea los personajes de tools/blender/personajes.json con MPFB2 y los exporta a GLB ligeros.

Uso (desde la raíz del proyecto):
  blender.exe --background --python tools/blender/crear_personajes.py -- [id ...]

Sin ids, genera todos. Salida: public/models/personajes/<id>.glb y manifest.json
"""
import glob
import json
import os
import sys
import traceback

import bpy

from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.exportservice import ExportService
from bl_ext.blender_org.mpfb.services.objectservice import ObjectService

ROOT = os.getcwd()
CONFIG = os.environ.get("PERSONAJES_JSON") or os.path.join(ROOT, "tools", "blender", "personajes.json")
OUT_DIR = os.environ.get("SALIDA_DIR") or os.path.join(ROOT, "public", "models", "personajes")
USER_DATA = os.path.join(
    os.environ["APPDATA"], "Blender Foundation", "Blender", "5.2",
    "extensions", ".user", "blender_org", "mpfb", "data",
)

# Tamaño máximo (en píxeles) de las texturas, según la pieza
TEXTURE_CAPS = {"body": 2048, "hair": 1024, "eyes": 512, "eyebrows": 512, "eyelashes": 512, "default": 1024}


def log(msg):
    print("[personajes]", msg, flush=True)


def find_asset(folder, name):
    base = os.path.join(USER_DATA, folder, name)
    exact = os.path.join(base, name + ".mhclo")
    if os.path.isfile(exact):
        return exact
    found = glob.glob(os.path.join(base, "*.mhclo"))
    if not found:
        raise FileNotFoundError("No existe el recurso %s/%s" % (folder, name))
    return found[0]


def mhclo_uuid(path):
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("uuid "):
                return line.split()[1].strip()
    return None


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)


def texture_cap(material_name):
    lowered = material_name.lower()
    for key in ("body", "eyes", "eyebrow", "eyelash", "hair"):
        if key in lowered:
            return TEXTURE_CAPS[{"eyebrow": "eyebrows", "eyelash": "eyelashes"}.get(key, key)]
    return TEXTURE_CAPS["default"]


def shrink_textures(objects):
    done = set()
    for obj in objects:
        if obj.type != "MESH":
            continue
        for slot in obj.material_slots:
            material = slot.material
            if not material or not material.node_tree:
                continue
            cap = texture_cap(obj.name if "body" not in material.name.lower() else material.name)
            if obj.name.lower().startswith(("human_export", "human.body")) or "base" in obj.name.lower():
                cap = TEXTURE_CAPS["body"]
            for node in material.node_tree.nodes:
                image = getattr(node, "image", None)
                if node.type == "TEX_IMAGE" and image and image.name not in done:
                    done.add(image.name)
                    width, height = image.size
                    longest = max(width, height)
                    if longest > cap:
                        factor = cap / longest
                        image.scale(max(1, int(width * factor)), max(1, int(height * factor)))


# Separación (en metros) hacia fuera de cada capa, para que el cuerpo no asome por la ropa
# y la camiseta quede por encima del pantalón. Los nombres se buscan dentro del nombre del objeto.
LAYER_OFFSETS = [
    (("pants", "jeans", "harem"), 0.003),
    (("skirt",), 0.003),    # la falda queda bajo el bajo de la camiseta, que cae más holgado
    (("shoes", "boots"), 0.002),
    (("hat", "cap", "fedora"), 0.002),
    (("bodice",), 0.012),   # top ajustado: sin esta holgura la cintura del pantalón asoma por la tela
]
TOP_OFFSET = 0.006
HEM_EXTRA = 0.022 # separación extra (m) en el bajo de camisetas y jerséis
LOOSE_TOP_WORDS = ("t-shirt", "sweater", "polo")
FOOTWEAR_WORDS = ("shoes", "boots")


def inflate_layers(objects, spec):
    clothes_names = [c.lower() for c in spec["clothes"]]
    for obj in objects:
        if obj.type != "MESH" or obj.data.shape_keys:
            continue
        # el nombre del objeto es "Human.<prenda>_export_copy..."
        lowered = obj.name.lower()
        if "base" in lowered or "human_export" in lowered or any(
            k in lowered for k in ("eye", "low-poly", "high-poly", "short", "afro", "hair")
        ):
            continue
        offset = TOP_OFFSET
        for words, value in LAYER_OFFSETS:
            if any(w in lowered for w in words):
                offset = value
                break
        is_loose_top = any(w in lowered for w in LOOSE_TOP_WORDS)
        zs = [v.co.z for v in obj.data.vertices]
        z_min, z_max = min(zs), max(zs)
        hem_zone = 0.25 * (z_max - z_min)
        for vertex in obj.data.vertices:
            extra = 0.0
            if is_loose_top and vertex.co.z < z_min + hem_zone:
                # el bajo de camisetas y jerséis cae holgado sobre el pantalón: así los bolsillos
                # y la pretina del pantalón no atraviesan la tela
                extra = HEM_EXTRA * (1.0 - (vertex.co.z - z_min) / hem_zone)
            vertex.co += vertex.normal * (offset + extra)
        obj.data.update()


def keep_body_under_clothes(basemesh, keep_words=None):
    """MPFB oculta el cuerpo bajo cada prenda con máscaras "Delete.*". Si entre dos prendas
    (camiseta y pantalón) queda una franja sin cubrir, se ve el vacío. Quitamos esas máscaras:
    el cuerpo queda entero bajo la ropa, que ya está separada unos milímetros hacia fuera."""
    for modifier in list(basemesh.modifiers):
        group = (modifier.vertex_group or "").lower()
        if modifier.type == "MASK" and group.startswith("delete."):
            # los pies sí se ocultan bajo el calzado: si no, los dedos asoman por el zapato
            if any(word in group for word in (keep_words or FOOTWEAR_WORDS)):
                continue
            basemesh.modifiers.remove(modifier)


def build(defaults, spec):
    clear_scene()
    macro = {
        "gender": 0.0 if spec.get("genero") == "mujer" else 1.0, "age": 0.5, "muscle": 0.5, "weight": 0.5, "proportions": 0.5,
        "height": 0.5, "cupsize": 0.5, "firmness": 0.5,
        "race": {"asian": 0.33, "caucasian": 0.33, "african": 0.33},
    }
    macro.update({k: v for k, v in spec["macro"].items() if k != "race"})
    macro["race"] = spec["macro"]["race"]

    basemesh = HumanService.create_human(macro_detail_dict=macro)
    rig = HumanService.add_builtin_rig(basemesh, defaults["rig"])
    skin = os.path.join(USER_DATA, "skins", spec["skin"], spec["skin"] + ".mhmat")
    HumanService.set_character_skin(skin, basemesh, skin_type="GAMEENGINE")

    parts = [
        ("eyes", "eyes", defaults["eyes"]),
        ("eyebrows", "eyebrows", defaults["eyebrows"]),
        ("eyelashes", "eyelashes", defaults["eyelashes"]),
    ]
    hair_alternative = None
    if spec.get("hair"):
        parts.append(("hair", "hair", spec["hair"]))
        if spec.get("hair_material"):
            # variante de color del peinado (carpeta dentro de hair/<peinado>/), p. ej. toigo_short_04_gray
            uuid = mhclo_uuid(find_asset("hair", spec["hair"]))
            variant = spec["hair_material"]
            hair_alternative = {uuid: variant + "/" + variant + ".mhmat"}
    for item in spec["clothes"]:
        parts.append(("clothes", "clothes", item))

    for kind, folder, name in parts:
        HumanService.add_mhclo_asset(
            find_asset(folder, name), basemesh, asset_type=kind,
            subdiv_levels=0, material_type="GAMEENGINE",
            alternative_materials=hair_alternative if kind == "hair" else None,
        )

    root = ExportService.create_character_copy(rig or basemesh)
    copy_base = ObjectService.find_object_of_type_amongst_nearest_relatives(root)
    keep_body_under_clothes(copy_base)
    ExportService.bake_modifiers_remove_helpers(
        copy_base, bake_masks=True, bake_subdiv=True, remove_helpers=True,
    )
    children = ObjectService.get_list_of_children(root)
    if os.environ.get("SIN_INFLAR") != "1":
        inflate_layers(children, spec)
    if os.environ.get("SIN_REDUCIR") != "1":
        shrink_textures(children)

    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in children:
        child.select_set(True)
    bpy.context.view_layer.objects.active = root

    out = os.path.join(OUT_DIR, spec["id"] + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_image_format=os.environ.get("FORMATO_IMAGEN", "WEBP"),
        export_image_quality=80,
        export_meshopt_compression_enable=True,
    )
    triangles = sum(len(c.data.polygons) for c in children if c.type == "MESH")
    return out, triangles


def main():
    with open(CONFIG, encoding="utf-8") as handle:
        config = json.load(handle)
    wanted = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    os.makedirs(OUT_DIR, exist_ok=True)

    results = {}
    for spec in config["personajes"]:
        if wanted and spec["id"] not in wanted:
            continue
        log("== %s ==" % spec["id"])
        try:
            out, tris = build(config["defaults"], spec)
            size = os.path.getsize(out) / 1048576
            results[spec["id"]] = {"mb": round(size, 2), "polygons": tris}
            log("%s: %.2f MB, %d polígonos" % (spec["id"], size, tris))
        except Exception:
            traceback.print_exc()
            results[spec["id"]] = {"error": True}

    manifest_path = os.path.join(OUT_DIR, "manifest.json")
    manifest = []
    for spec in config["personajes"]:
        glb = os.path.join(OUT_DIR, spec["id"] + ".glb")
        if os.path.isfile(glb):
            manifest.append({
                "id": spec["id"], "nombre": spec["nombre"], "descripcion": spec["descripcion"],
                "archivo": "personajes/" + spec["id"] + ".glb",
            })
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
    log("resumen: " + json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
