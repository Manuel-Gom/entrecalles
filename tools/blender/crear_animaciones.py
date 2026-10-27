"""Junta las animaciones de Mixamo (FBX sin malla) en un solo GLB que el navegador adapta a cada cuerpo.

Uso (desde la raíz del proyecto):
  blender.exe --background --python tools/blender/crear_animaciones.py

Lee tools/blender/animaciones/mixamo/*.fbx (descargadas de mixamo.com con «Without Skin» y 30 fps; los bucles con
«In Place»). Cada archivo da una animación con su nombre (anda.fbx -> "anda").
Salida:
  public/models/animaciones/mixamo.glb   (el esqueleto de Mixamo en reposo, en T, y una animación por archivo)

La adaptación al esqueleto de cada cuerpo se hace al cargar, en src/avatar/retarget.ts.
"""
import glob
import os
import sys
import traceback

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SOURCE = os.path.join(ROOT, "tools", "blender", "animaciones", "mixamo")
OUT = os.path.join(ROOT, "public", "models", "animaciones", "mixamo.glb")


def import_clip(path):
    """Importa un FBX y devuelve (esqueleto, acción)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, ignore_leaf_bones=True)
    new = [obj for obj in bpy.data.objects if obj not in before]
    armature = next(obj for obj in new if obj.type == "ARMATURE")
    action = armature.animation_data.action
    return armature, new, action


def main():
    files = sorted(glob.glob(os.path.join(SOURCE, "*.fbx")))
    if not files:
        raise SystemExit(f"No hay animaciones en {SOURCE}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30

    keeper = None
    clips = []
    for path in files:
        name = os.path.splitext(os.path.basename(path))[0]
        armature, objects, action = import_clip(path)
        action.name = name
        action.use_fake_user = True
        if keeper is None:
            keeper = armature
            keeper.name = "mixamo"
        else:
            # todas comparten esqueleto: el resto de esqueletos (y mallas sueltas, si las hubiera) sobran
            armature.animation_data.action = None
            for obj in objects:
                bpy.data.objects.remove(obj, do_unlink=True)
        clips.append((name, action))
        start, end = action.frame_range
        print(f"  {name}: fotogramas {start:.0f}-{end:.0f}")

    for obj in list(bpy.data.objects):
        if obj is not keeper:
            bpy.data.objects.remove(obj, do_unlink=True)

    # una pista NLA por animación: el exportador las saca como animaciones separadas con el nombre de la pista
    data = keeper.animation_data
    data.action = None
    for name, action in clips:
        track = data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, int(action.frame_range[0]), action)
        strip.name = name
        if action.slots:
            strip.action_slot = action.slots[0]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    keeper.select_set(True)
    bpy.context.view_layer.objects.active = keeper
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_skins=False,
        export_morph=False,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_frame_step=1,
        export_reset_pose_bones=True,
    )
    print(f"{len(clips)} animaciones -> {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB)")


try:
    main()
except Exception:
    traceback.print_exc()
    sys.exit(1)
