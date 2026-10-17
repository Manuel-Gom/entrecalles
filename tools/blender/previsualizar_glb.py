"""Renderiza una imagen de un .glb para revisarlo sin abrir Blender.

Uso:
  blender.exe --background --python tools/blender/previsualizar_glb.py -- entrada.glb salida.png [vista]
vista: frente (por defecto), lateral o cara
"""
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
glb, png = os.path.abspath(args[0]), os.path.abspath(args[1])
view = args[2] if len(args) > 2 else "frente"

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.import_scene.gltf(filepath=glb)

# el importador crea esferas auxiliares para dibujar los huesos: no son parte del personaje
for obj in list(bpy.data.objects):
    if obj.type == "MESH" and obj.name.startswith("Icosphere"):
        bpy.data.objects.remove(obj, do_unlink=True)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 48
scene.cycles.use_denoising = False
scene.render.resolution_x = 700
scene.render.resolution_y = 1000 if view in ("frente", "lateral") else 700
scene.render.filepath = png

world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.09, 0.11, 0.1, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
scene.world = world

# altura del personaje
min_z, max_z = 1e9, -1e9
for obj in bpy.data.objects:
    if obj.type == "MESH":
        for corner in obj.bound_box:
            z = (obj.matrix_world @ Vector(corner)).z
            min_z, max_z = min(min_z, z), max(max_z, z)
height = max_z - min_z
print("[previsualizar] altura aprox: %.2f m" % height)

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.lens = 70

if view == "cara":
    target = Vector((0, 0, max_z - 0.11))
    dist = 1.1
elif view == "pies":
    target = Vector((0, 0, min_z + 0.08))
    dist = 1.0
elif view == "cintura":
    target = Vector((0, 0, min_z + height * 0.53))
    dist = 1.3
else:
    target = Vector((0, 0, (min_z + max_z) / 2))
    dist = height * 2.2
angle = {"frente": 0, "lateral": 90, "cara": 0, "cintura": 0, "pies": 0}[view]
cam.location = target + Vector((math.sin(math.radians(angle)) * -dist, math.cos(math.radians(angle)) * -dist * -1, 0))
# el glTF importado mira a -Y en Blender: la cámara va en -Y
cam.location = target + Vector((math.sin(math.radians(angle)) * dist, -math.cos(math.radians(angle)) * dist, 0))
direction = target - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

for name, loc, energy in (("key", (-2.5, -3, 3), 450), ("fill", (3, -2, 1.5), 180), ("rim", (0, 3, 3), 300)):
    light_data = bpy.data.lights.new(name, "AREA")
    light_data.energy = energy
    light_data.size = 2
    light = bpy.data.objects.new(name, light_data)
    light.location = loc
    scene.collection.objects.link(light)
    light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()

bpy.ops.render.render(write_still=True)
print("[previsualizar] imagen guardada en", png)
