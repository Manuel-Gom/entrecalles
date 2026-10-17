"""Primera prueba: crea un personaje con MPFB2 en segundo plano y lo exporta a GLB.

Uso (desde la raíz del proyecto):
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background --python tools/blender/prueba_personaje.py -- public/models/prueba-personaje.glb

Es una prueba: sirve para descubrir qué falla en tu versión de Blender/MPFB.
"""
import os
import sys
import traceback

import bpy

from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.exportservice import ExportService
from bl_ext.blender_org.mpfb.services.objectservice import ObjectService

USER_DATA = os.path.join(
    os.environ["APPDATA"], "Blender Foundation", "Blender", "5.2",
    "extensions", ".user", "blender_org", "mpfb", "data",
)

# (carpeta, nombre del archivo .mhclo/.mhmat sin extensión)
SKIN = ("skins", "young_caucasian_male")
EYES = ("eyes", "low-poly")
EYEBROWS = ("eyebrows", "eyebrow001")
EYELASHES = ("eyelashes", "eyelashes01")
HAIR = ("hair", "short02")
CLOTHES = [
    ("clothes", "toigo_basic_tucked_t-shirt"),
    ("clothes", "cortu_cargo_pants"),
    ("clothes", "shoes01"),
]


def asset(folder, name, ext):
    return os.path.join(USER_DATA, folder, name, name + ext)


def log(msg):
    print("[prueba]", msg, flush=True)


def main():
    out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "prueba-personaje.glb"
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    log("creando humano base")
    basemesh = HumanService.create_human()

    log("añadiendo esqueleto game_engine")
    rig = HumanService.add_builtin_rig(basemesh, "game_engine")
    log("esqueleto: %s" % rig)

    log("aplicando piel")
    HumanService.set_character_skin(asset(*SKIN, ".mhmat"), basemesh, skin_type="GAMEENGINE")

    for kind, (folder, name) in (
        ("eyes", EYES), ("eyebrows", EYEBROWS), ("eyelashes", EYELASHES), ("hair", HAIR),
    ):
        log("añadiendo %s: %s" % (kind, name))
        HumanService.add_mhclo_asset(
            asset(folder, name, ".mhclo"), basemesh, asset_type=kind,
            subdiv_levels=0, material_type="GAMEENGINE",
        )

    for folder, name in CLOTHES:
        log("añadiendo ropa: %s" % name)
        HumanService.add_mhclo_asset(
            asset(folder, name, ".mhclo"), basemesh, asset_type="clothes",
            subdiv_levels=0, material_type="GAMEENGINE",
        )

    log("creando copia de exportación")
    root = ExportService.create_character_copy(rig or basemesh)
    copy_base = ObjectService.find_object_of_type_amongst_nearest_relatives(root)
    ExportService.bake_modifiers_remove_helpers(
        copy_base, bake_masks=True, bake_subdiv=True, remove_helpers=True,
    )

    # selecciona solo la copia y sus hijos
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in ObjectService.get_list_of_children(root):
        child.select_set(True)
    bpy.context.view_layer.objects.active = root

    log("exportando a %s" % out)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_skins=True,
        export_image_format="AUTO",
    )
    log("hecho: %.1f MB" % (os.path.getsize(out) / 1048576))


try:
    main()
except Exception:
    traceback.print_exc()
    sys.exit(1)
