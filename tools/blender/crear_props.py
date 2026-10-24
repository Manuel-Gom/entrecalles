"""Genera los modelos del mundo (mobiliario, parque y café) en public/models/mundo/.

Uso (desde la raíz del proyecto):
  blender.exe --background --python tools/blender/crear_props.py
  blender.exe --background --python tools/blender/crear_props.py -- luna_nueva  (solo uno: banco, fachada, interior, fuente, arbol, farola, sol, luna o una fase lunar)

Convenciones (las lee src/world/props.ts):
- Se modela en Blender con el frente hacia -Y; el exportador lo convierte a glTF (+Z hacia delante, +Y arriba).
- Los objetos vacíos son datos: COL_* = caja de colisión (la escala es la mitad del tamaño), SEAT_* = plaza (mira hacia
  donde apunta su frente), LUZ_* = punto de luz, SALIDA / ENTRADA = disparador y punto de aparición.
- Un objeto llamado PUERTA_HOJA es la hoja de una puerta: su origen es la bisagra y se gira en el navegador.
- Sin texturas: solo colores de material, así que pesan unos pocos KB.
Todo se hace por código: no hay modelos de terceros, y se dedica al dominio público (CC0).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SALIDA = os.environ.get("SALIDA_DIR") or os.path.join(RAIZ, "public", "models", "mundo")


def reiniciar():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    global _materiales
    _materiales = {}


_materiales = {}


def material(nombre, color, rugosidad=0.85, metal=0.0, alfa=None):
    """Material de un solo color (hex 'RRGGBB'), con transparencia opcional."""
    if nombre in _materiales:
        return _materiales[nombre]
    mat = bpy.data.materials.new(nombre)
    mat.use_nodes = True
    nodo = mat.node_tree.nodes["Principled BSDF"]
    r, g, b = (int(color[i : i + 2], 16) / 255 for i in (0, 2, 4))
    # el hex es sRGB; Blender trabaja en lineal
    lineal = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    nodo.inputs["Base Color"].default_value = (lineal(r), lineal(g), lineal(b), 1)
    nodo.inputs["Roughness"].default_value = rugosidad
    nodo.inputs["Metallic"].default_value = metal
    if alfa is not None:
        nodo.inputs["Alpha"].default_value = alfa
        # según la versión de Blender el modo de mezcla se llama de una forma u otra
        for atributo, valor in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            if hasattr(mat, atributo):
                try:
                    setattr(mat, atributo, valor)
                except (TypeError, AttributeError):
                    pass
    _materiales[nombre] = mat
    return mat


class Grupo:
    """Acumula cajas de un mismo material en una sola malla (una llamada de dibujo)."""

    def __init__(self, nombre, mat):
        self.nombre = nombre
        self.mat = mat
        self.bm = bmesh.new()

    def caja(self, tamano, centro, giro=(0, 0, 0), bisel=0.0):
        """tamano y centro en metros (x, y, z de Blender); giro en grados (X, Y, Z) sobre el centro."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= tamano[0]
            v.co.y *= tamano[1]
            v.co.z *= tamano[2]
        if bisel > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bisel, segments=1, affect="EDGES")
        rot = Matrix.Rotation(math.radians(giro[2]), 4, "Z") @ Matrix.Rotation(math.radians(giro[1]), 4, "Y") @ Matrix.Rotation(math.radians(giro[0]), 4, "X")
        bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(centro)) @ rot, verts=bm.verts)
        self._anadir(bm)

    def cilindro(self, radio, alto, centro, segmentos=12, radio2=None):
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=segmentos,
            radius1=radio, radius2=radio if radio2 is None else radio2, depth=alto,
        )
        bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(centro)), verts=bm.verts)
        self._anadir(bm)

    def segmento(self, inicio, fin, radio_inicio, radio_fin, segmentos=10):
        """Cono entre dos puntos; se usa para troncos y brazos curvos."""
        a = Vector(inicio)
        b = Vector(fin)
        direccion = b - a
        if direccion.length == 0:
            return
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=segmentos,
            radius1=radio_inicio, radius2=radio_fin, depth=direccion.length,
        )
        rotacion = Vector((0, 0, 1)).rotation_difference(direccion.normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rotacion, verts=bm.verts)
        self._anadir(bm)

    def esfera(self, radio, centro, escala=(1, 1, 1), subdivisiones=2, irregularidad=0.0):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdivisiones, radius=radio)
        for vert in bm.verts:
            if irregularidad:
                onda = math.sin(vert.co.x * 8 + vert.co.y * 5) * math.cos(vert.co.z * 7 - vert.co.x * 3)
                vert.co *= 1 + onda * irregularidad
            vert.co.x *= escala[0]
            vert.co.y *= escala[1]
            vert.co.z *= escala[2]
        bmesh.ops.translate(bm, vec=Vector(centro), verts=bm.verts)
        self._anadir(bm)

    def toro(self, radio, tubo, centro, segmentos=32, lados=10):
        """Anillo redondo de perfil para remates de piedra y luminarias."""
        bm = bmesh.new()
        verts = []
        faces = []
        for i in range(segmentos):
            a = 2 * math.pi * i / segmentos
            for j in range(lados):
                b = 2 * math.pi * j / lados
                ring = radio + tubo * math.cos(b)
                verts.append((
                    centro[0] + ring * math.cos(a),
                    centro[1] + ring * math.sin(a),
                    centro[2] + tubo * math.sin(b),
                ))
        for i in range(segmentos):
            for j in range(lados):
                a = i * lados + j
                b = i * lados + (j + 1) % lados
                c = ((i + 1) % segmentos) * lados + (j + 1) % lados
                d = ((i + 1) % segmentos) * lados + j
                faces.append((a, b, c, d))
        mesh = bpy.data.meshes.new("tmp_toro")
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        bm.from_mesh(mesh)
        bm.normal_update()
        bpy.data.meshes.remove(mesh)
        self._anadir(bm)

    def revolucion(self, perfil, centro=(0, 0, 0), segmentos=32, esquina=35.0):
        """Pieza torneada: gira un perfil [(radio, altura), ...] alrededor del eje Z.

        El perfil se recorre en sentido antihorario (sube por fuera y vuelve por dentro) para que las normales salgan
        hacia fuera. Un punto con radio 0 es el eje. En las esquinas de más de `esquina` grados el perfil se corta, así
        los cantos quedan vivos aunque todo se suavice.
        """
        bm = bmesh.new()
        tiras = [[perfil[0]]]
        for i in range(1, len(perfil)):
            tiras[-1].append(perfil[i])
            if i < len(perfil) - 1:
                a = (perfil[i][0] - perfil[i - 1][0], perfil[i][1] - perfil[i - 1][1])
                b = (perfil[i + 1][0] - perfil[i][0], perfil[i + 1][1] - perfil[i][1])
                giro = abs(math.degrees(math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])))
                if giro > esquina:
                    tiras.append([perfil[i]])
        for tira in tiras:
            anillos = []
            for radio, altura in tira:
                if radio < 1e-6:
                    anillos.append([bm.verts.new((centro[0], centro[1], centro[2] + altura))])
                else:
                    anillos.append([
                        bm.verts.new((centro[0] + radio * math.cos(math.tau * j / segmentos), centro[1] + radio * math.sin(math.tau * j / segmentos), centro[2] + altura))
                        for j in range(segmentos)
                    ])
            for i in range(len(anillos) - 1):
                a, c = anillos[i], anillos[i + 1]
                for j in range(segmentos):
                    j2 = (j + 1) % segmentos
                    if len(a) == 1 and len(c) == 1:
                        continue
                    if len(a) == 1:
                        bm.faces.new((a[0], c[j2], c[j]))
                    elif len(c) == 1:
                        bm.faces.new((a[j], a[j2], c[0]))
                    else:
                        bm.faces.new((a[j], a[j2], c[j2], c[j]))
        self._anadir(bm)

    def _anadir(self, bm):
        malla = bpy.data.meshes.new("tmp")
        bm.to_mesh(malla)
        bm.free()
        self.bm.from_mesh(malla)
        bpy.data.meshes.remove(malla)

    def crear(self, origen=(0, 0, 0), suavizar=False):
        """Convierte lo acumulado en un objeto. `origen` es donde queda su origen (p. ej. una bisagra)."""
        if not self.bm.faces:
            self.bm.free()
            return None
        malla = bpy.data.meshes.new(self.nombre)
        desplazamiento = Vector(origen)
        bmesh.ops.translate(self.bm, vec=-desplazamiento, verts=self.bm.verts)
        self.bm.to_mesh(malla)
        self.bm.free()
        malla.materials.append(self.mat)
        objeto = bpy.data.objects.new(self.nombre, malla)
        objeto.location = desplazamiento
        if suavizar:
            for poligono in malla.polygons:
                poligono.use_smooth = True
        bpy.context.scene.collection.objects.link(objeto)
        return objeto


def vacio(nombre, ubicacion, escala=(1, 1, 1), giro_z=0.0, tipo="CUBE"):
    e = bpy.data.objects.new(nombre, None)
    e.empty_display_type = tipo
    e.empty_display_size = 1.0
    e.location = ubicacion
    e.scale = escala
    e.rotation_euler = (0, 0, math.radians(giro_z))
    bpy.context.scene.collection.objects.link(e)
    return e


def colision(nombre, centro, tamano, giro_z=0.0):
    """Caja de colisión: `tamano` es el tamaño completo."""
    return vacio("COL_" + nombre, centro, (tamano[0] / 2, tamano[1] / 2, tamano[2] / 2), giro_z)


def exportar(nombre):
    os.makedirs(SALIDA, exist_ok=True)
    ruta = os.path.join(SALIDA, nombre + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=ruta,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_meshopt_compression_enable=True,
    )
    triangulos = sum(len(o.data.polygons) + sum(max(0, len(p.vertices) - 3) for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"{nombre}.glb: {os.path.getsize(ruta) / 1024:.1f} KB, ~{triangulos} triángulos")


# --------------------------------------------------------------------------- banco

def banco():
    reiniciar()
    madera = Grupo("banco_madera", material("Madera", "8a6a45", 0.8))
    metal = Grupo("banco_metal", material("Hierro", "2e3033", 0.55, 0.6))
    largo = 1.6
    # asiento: 4 listones, el frente hacia -Y
    for y in (-0.165, -0.055, 0.055, 0.165):
        madera.caja((largo, 0.09, 0.035), (0, y, 0.44), bisel=0.004)
    # respaldo: 3 listones inclinados hacia atrás, sobre el borde trasero del asiento
    for i, z in enumerate((0.58, 0.70, 0.82)):
        madera.caja((largo, 0.03, 0.095), (0, 0.235 + 0.026 * i, z), (-12, 0, 0), bisel=0.004)
    # bastidores de hierro a los dos lados
    for x in (-largo / 2 + 0.06, largo / 2 - 0.06):
        metal.caja((0.045, 0.04, 0.44), (x, -0.19, 0.22), bisel=0.004)  # pata delantera
        metal.caja((0.045, 0.04, 0.44), (x, 0.2, 0.22), bisel=0.004)  # pata trasera
        metal.caja((0.045, 0.05, 0.52), (x, 0.245, 0.69), (-12, 0, 0), bisel=0.004)  # montante del respaldo
        metal.caja((0.045, 0.46, 0.035), (x, 0.0, 0.41), bisel=0.004)  # larguero bajo el asiento
        metal.caja((0.06, 0.42, 0.035), (x, -0.01, 0.65), bisel=0.004)  # reposabrazos
        metal.caja((0.045, 0.035, 0.24), (x, -0.185, 0.53), bisel=0.004)  # apoyo del reposabrazos
    metal.caja((largo - 0.14, 0.03, 0.03), (0, 0.0, 0.18), bisel=0.004)  # travesaño
    madera.crear()
    metal.crear()
    # datos: colisión y plazas (dos, a ±0,4 m)
    colision("banco", (0, 0.02, 0.45), (largo, 0.5, 0.9))
    vacio("SEAT_0", (-0.4, 0, 0.46), tipo="ARROWS")
    vacio("SEAT_1", (0.4, 0, 0.46), tipo="ARROWS")
    exportar("banco")


# --------------------------------------------------------------------------- fachada con puerta

def fachada():
    reiniciar()
    crema = Grupo("fachada_muro", material("Muro", "e6d9bd", 0.9))
    marco = Grupo("fachada_marco", material("MarcoMadera", "4a3524", 0.7))
    cristal = Grupo("fachada_cristal", material("Cristal", "7fa3b5", 0.1, alfa=0.3))
    toldo_rojo = Grupo("fachada_toldo_rojo", material("ToldoRojo", "b5352f", 0.9))
    toldo_crema = Grupo("fachada_toldo_crema", material("ToldoCrema", "efe6d0", 0.9))
    cartel = Grupo("fachada_cartel", material("Cartel", "1d2622", 0.6))
    letras = Grupo("fachada_letras", material("Letras", "d5eb77", 0.5))
    fondo_puerta = Grupo("fachada_fondo_puerta", material("FondoPuerta", "241811", 0.95))
    fondo_ventana = Grupo("fachada_fondo_ventana", material("FondoVentana", "bfa57a", 0.9))

    ancho, alto, fondo = 5.0, 3.6, 0.3
    # el muro es una sucesión de cajas alrededor de la ventana y la puerta (el frente es -Y: mira hacia -Y)
    def muro(x0, x1, z0, z1):
        crema.caja((x1 - x0, fondo, z1 - z0), ((x0 + x1) / 2, fondo / 2, (z0 + z1) / 2), bisel=0.01)

    muro(-2.5, -2.1, 0, alto)  # pilastra izquierda
    muro(0.5, 0.9, 0, alto)  # pilastra central
    muro(1.9, 2.5, 0, alto)  # pilastra derecha
    muro(-2.1, 0.5, 0, 0.85)  # bajo la ventana
    muro(-2.1, 0.5, 2.4, alto)  # sobre la ventana
    muro(0.9, 1.9, 2.2, alto)  # sobre la puerta
    # detrás de los huecos, un fondo a 2 cm del plano del edificio (el módulo se coloca 3 cm por delante del muro):
    # así, al abrirse la puerta o mirar por la ventana, no se ve la fachada de ventanas del edificio de detrás
    fondo_puerta.caja((1.0, 0.01, 2.2), (1.4, 0.02, 1.1))
    fondo_ventana.caja((2.6, 0.01, 1.55), (-0.8, 0.02, 1.625))
    # cristal de la ventana y marco
    cristal.caja((2.6, 0.02, 1.55), (-0.8, 0.12, 1.625))
    for x0, x1, z0, z1 in ((-2.1, 0.5, 0.85, 0.93), (-2.1, 0.5, 2.32, 2.4), (-2.1, -2.02, 0.85, 2.4), (0.42, 0.5, 0.85, 2.4)):
        marco.caja((x1 - x0, 0.1, z1 - z0), ((x0 + x1) / 2, 0.08, (z0 + z1) / 2), bisel=0.005)
    marco.caja((0.04, 0.08, 1.55), (-0.8, 0.1, 1.625))  # parteluz
    # marco de la puerta
    marco.caja((0.06, 0.12, 2.2), (0.93, 0.08, 1.1), bisel=0.005)
    marco.caja((0.06, 0.12, 2.2), (1.87, 0.08, 1.1), bisel=0.005)
    marco.caja((1.0, 0.12, 0.06), (1.4, 0.08, 2.17), bisel=0.005)
    marco.caja((1.0, 0.2, 0.03), (1.4, 0.0, 0.015))  # umbral
    # toldo a rayas, saliendo hacia el frente (-Y) y bajando un poco
    for i in range(10):
        grupo = toldo_rojo if i % 2 == 0 else toldo_crema
        x = -2.4 + 0.5 * i + 0.25
        grupo.caja((0.5, 1.0, 0.04), (x, -0.45, 2.78), (18, 0, 0), bisel=0.004)
    toldo_rojo.caja((5.0, 0.04, 0.16), (0, -0.92, 2.54))  # faldón
    # cartel sobre el toldo, con el nombre
    cartel.caja((2.6, 0.08, 0.42), (-0.4, -0.02, 3.3), bisel=0.01)
    for g in (crema, marco, cristal, toldo_rojo, toldo_crema, cartel, fondo_puerta, fondo_ventana):
        g.crear()

    # letras "CAFÉ"
    curva = bpy.data.curves.new("letras_curva", "FONT")
    curva.body = "CAFÉ"
    curva.size = 0.3
    curva.extrude = 0.012
    curva.align_x = "CENTER"
    curva.align_y = "CENTER"
    texto = bpy.data.objects.new("fachada_letras", curva)
    texto.location = (-0.4, -0.075, 3.3)
    texto.rotation_euler = (math.radians(90), 0, 0)  # de pie, legible desde el frente (-Y)
    texto.data.materials.append(letras.mat)
    bpy.context.scene.collection.objects.link(texto)
    letras.bm.free()
    bpy.context.view_layer.objects.active = texto
    texto.select_set(True)
    bpy.ops.object.convert(target="MESH")

    # hoja de la puerta: origen en la bisagra (borde izquierdo visto desde fuera: x = 0,93)
    hoja = Grupo("PUERTA_HOJA", material("MaderaPuerta", "6b4a2f", 0.65))
    vidrio = Grupo("PUERTA_VIDRIO", cristal.mat)
    # la hoja ocupa el hueco: de la bisagra (x = 0,93) hasta x = 1,85
    hoja.caja((0.92, 0.05, 2.13), (1.39, 0.08, 1.075), bisel=0.005)
    hoja.caja((0.06, 0.09, 0.14), (1.75, 0.04, 1.05))  # tirador, por fuera
    vidrio.caja((0.52, 0.06, 0.9), (1.39, 0.08, 1.55))
    hoja.crear(origen=(0.93, 0.08, 0))
    objeto_vidrio = vidrio.crear(origen=(0.93, 0.08, 0))
    objeto_vidrio.name = "PUERTA_VIDRIO"
    # el cristal gira con la hoja
    hoja_obj = bpy.data.objects["PUERTA_HOJA"]
    objeto_vidrio.parent = hoja_obj
    objeto_vidrio.location = (0, 0, 0)

    # datos: la puerta (centro del hueco) y un punto desde el que se llama a ella
    vacio("PUERTA_CENTRO", (1.4, 0.1, 0), tipo="ARROWS")
    colision("muro", (0, fondo / 2, alto / 2), (ancho, fondo, alto))
    exportar("fachada_cafe")


# --------------------------------------------------------------------------- interior del café

def interior():
    reiniciar()
    suelo_a = Grupo("suelo_claro", material("BaldosaClara", "e8e1cf", 0.6))
    suelo_b = Grupo("suelo_oscuro", material("BaldosaOscura", "3c6a66", 0.6))
    muro = Grupo("muros", material("MuroInterior", "d9c7a3", 0.9))
    zocalo = Grupo("zocalo", material("Zocalo", "5a3f2a", 0.7))
    madera = Grupo("madera", material("MaderaMueble", "8a6a45", 0.7))
    oscuro = Grupo("hierro", material("HierroMueble", "2a2d30", 0.5, 0.5))
    tapizado = Grupo("tapizado", material("Tapizado", "a8402f", 0.9))
    cafe = Grupo("detalles", material("Detalle", "c9c3b4", 0.35, 0.6))
    pizarra = Grupo("pizarra", material("Pizarra", "1d2622", 0.9))
    cuadro = Grupo("cuadros", material("Cuadro", "d5eb77", 0.8))

    ancho, fondo, alto = 8.0, 7.0, 3.2
    # La entrada está en y = 0 y la sala se adentra hacia -Y, para que al exportar quede hacia +Z (hacia delante desde la puerta).
    def y(v):
        return -v

    # suelo de baldosas 1 x 1
    for i in range(8):
        for j in range(7):
            grupo = suelo_a if (i + j) % 2 == 0 else suelo_b
            grupo.caja((1, 1, 0.04), (-3.5 + i, y(j + 0.5), -0.02))
    # muros (sin techo): grosor 0,2 hacia fuera
    t = 0.2
    muro.caja((ancho + 2 * t, t, alto), (0, y(fondo) - t / 2, alto / 2))  # fondo
    muro.caja((t, fondo, alto), (-ancho / 2 - t / 2, y(fondo / 2), alto / 2))  # izquierda
    muro.caja((t, fondo, alto), (ancho / 2 + t / 2, y(fondo / 2), alto / 2))  # derecha
    muro.caja((3.5, t, alto), (-2.25, y(0) + t / 2, alto / 2))  # frente, a la izquierda de la puerta
    muro.caja((3.5, t, alto), (2.25, y(0) + t / 2, alto / 2))  # frente, a la derecha
    muro.caja((1.0, t, alto - 2.3), (0, y(0) + t / 2, 2.3 + (alto - 2.3) / 2))  # sobre la puerta
    # zócalo de madera
    zocalo.caja((ancho, 0.03, 1.0), (0, y(fondo) + 0.015, 0.5))
    zocalo.caja((0.03, fondo, 1.0), (-ancho / 2 + 0.015, y(fondo / 2), 0.5))
    zocalo.caja((0.03, fondo, 1.0), (ancho / 2 - 0.015, y(fondo / 2), 0.5))
    zocalo.caja((3.5, 0.03, 1.0), (-2.25, y(0) - 0.015, 0.5))
    zocalo.caja((3.5, 0.03, 1.0), (2.25, y(0) - 0.015, 0.5))
    # mostrador al fondo, con la parte de trabajo detrás
    madera.caja((5.2, 0.7, 1.0), (-0.2, y(5.9), 0.5), bisel=0.01)
    madera.caja((5.4, 0.85, 0.05), (-0.2, y(5.85), 1.025), bisel=0.01)
    cafe.caja((0.7, 0.55, 0.5), (-2.0, y(6.2), 1.3), bisel=0.02)  # cafetera
    cafe.cilindro(0.12, 0.3, (-1.2, y(6.1), 1.2))  # molinillo
    oscuro.caja((5.2, 0.35, 0.05), (-0.2, y(6.75), 1.7))  # estante
    oscuro.caja((5.2, 0.35, 0.05), (-0.2, y(6.75), 2.2))
    for i in range(10):
        cafe.cilindro(0.05, 0.22, (-2.6 + i * 0.55, y(6.75), 1.83), 8)  # botes
    pizarra.caja((2.0, 0.04, 1.1), (1.8, y(fondo) - 0.02 + 0.04, 2.1), bisel=0.01)  # carta en la pared
    # taburetes del mostrador (cada uno con su plaza)
    for k, x in enumerate((-1.6, -0.4, 0.8)):
        oscuro.cilindro(0.04, 0.6, (x, y(5.1), 0.3), 8)
        tapizado.cilindro(0.19, 0.07, (x, y(5.1), 0.64), 10)
        oscuro.cilindro(0.17, 0.02, (x, y(5.1), 0.02), 10)
    # mesas redondas con dos sillas
    # (las sillas se alcanzan por detrás, así que dejan sitio entre su respaldo y la pared)
    mesas = [(-1.9, 1.9), (-1.9, 3.6), (2.0, 2.1), (2.0, 3.9)]
    plazas = []
    for (mx, my) in mesas:
        madera.cilindro(0.5, 0.04, (mx, y(my), 0.75), 14)
        oscuro.cilindro(0.04, 0.73, (mx, y(my), 0.37), 8)
        oscuro.cilindro(0.28, 0.03, (mx, y(my), 0.015), 12)
        for lado in (-1, 1):
            cx, cy = mx + lado * 0.85, my
            madera.caja((0.42, 0.42, 0.04), (cx, y(cy), 0.45), bisel=0.005)
            for dx in (-0.18, 0.18):
                for dy in (-0.18, 0.18):
                    oscuro.caja((0.035, 0.035, 0.45), (cx + dx, y(cy + dy), 0.225))
            # respaldo en el lado contrario a la mesa
            madera.caja((0.04, 0.42, 0.4), (cx + lado * 0.2, y(cy), 0.68), bisel=0.005)
            # la plaza mira hacia la mesa: el frente de la silla es hacia el lado de la mesa
            yaw = 90 if lado == -1 else -90
            plazas.append((cx, y(cy), yaw))
        colision("mesa", (mx, y(my), 0.4), (1.0, 1.0, 0.8))
    # cuadros
    for i, x in enumerate((-2.4, -0.8, 0.8)):
        cuadro.caja((0.7, 0.03, 0.5), (x, y(fondo) + 0.015 + 0.0, 2.2 - 0.0))
    # planta junto a la puerta
    madera.cilindro(0.2, 0.35, (3.4, y(0.6), 0.18), 10, 0.15)
    cuadro.cilindro(0.3, 0.6, (3.4, y(0.6), 0.65), 8, 0.05)

    for g in (suelo_a, suelo_b, muro, zocalo, madera, oscuro, tapizado, cafe, pizarra, cuadro):
        g.crear()

    # datos
    colision("pared_fondo", (0, y(fondo) - t / 2, alto / 2), (ancho + 2 * t, t, alto))
    colision("pared_izquierda", (-ancho / 2 - t / 2, y(fondo / 2), alto / 2), (t, fondo, alto))
    colision("pared_derecha", (ancho / 2 + t / 2, y(fondo / 2), alto / 2), (t, fondo, alto))
    colision("pared_frente_izq", (-2.25, y(0) + t / 2, alto / 2), (3.5, t, alto))
    colision("pared_frente_der", (2.25, y(0) + t / 2, alto / 2), (3.5, t, alto))
    # el hueco de la puerta queda cerrado a efectos de colisión y de cámara: se sale con la tecla de interactuar, no andando
    colision("pared_puerta", (0, y(0) + t / 2, alto / 2), (1.0, t, alto))
    colision("mostrador", (-0.2, y(5.9), 0.5), (5.4, 0.9, 1.0))
    colision("estanteria", (-0.2, y(6.75), 1.95), (5.2, 0.45, 0.7))
    for i, (px, py, giro) in enumerate(plazas):
        vacio(f"SEAT_silla{i}", (px, py, 0.47), giro_z=giro, tipo="ARROWS")
    for k, x in enumerate((-1.6, -0.4, 0.8)):
        vacio(f"SEAT_taburete{k}", (x, y(5.1), 0.67), giro_z=0, tipo="ARROWS")  # mirando al mostrador (hacia el fondo)
        colision(f"taburete{k}", (x, y(5.1), 0.34), (0.42, 0.42, 0.68))
    for i, (px, py, giro) in enumerate(plazas):
        colision(f"silla{i}", (px, py, 0.45), (0.58, 0.58, 0.9), giro_z=giro)
    colision("lampara", (3.4, y(0.6), 0.5), (0.7, 0.7, 1.0))
    for i, (lx, ly) in enumerate(((-2.6, 3.4), (2.4, 3.4), (0.0, 6.0), (0.0, 1.2))):
        vacio(f"LUZ_{i}", (lx, y(ly), 2.4), tipo="SPHERE")
    vacio("ENTRADA", (0, y(1.6), 0), tipo="ARROWS")
    vacio("SALIDA", (0, y(0.35), 0), (0.7, 0.45, 1.0))
    exportar("cafe_interior")


# --------------------------------------------------------------------------- parque

def fuente():
    reiniciar()
    # Tres niveles (pilón, taza grande y taza pequeña) torneados con perfiles. Alturas del agua: 0,40 / 1,325 / 1,655 m;
    # src/world/water.ts las usa para saber en qué lámina está cada punto, así que no las cambies sin tocarlo.
    piedra = Grupo("piedra_fuente", material("PiedraFuente", "aaa69b", 0.86))
    borde = Grupo("detalle_piedra", material("PiedraClara", "d0cabe", 0.78))
    fondo = Grupo("fondo", material("FondoFuente", "56644f", 0.95))
    agua = Grupo("agua", material("AguaFuente", "559bb0", 0.12, 0.0))
    chorro = Grupo("chorros", material("ChorroFuente", "eaf7fb", 0.1, 0.0, 0.55))
    metal = Grupo("detalle_metal", material("BronceFuente", "756b55", 0.4, 0.68))

    # pilón: zócalo, pared con moldura, borde grueso y suelo hundido
    piedra.revolucion([
        (0, 0.0), (1.52, 0.0), (1.52, 0.10), (1.58, 0.14), (1.58, 0.36), (1.62, 0.40), (1.62, 0.47),
        (1.56, 0.51), (1.46, 0.51), (1.41, 0.47), (1.41, 0.19), (0, 0.19),
    ], segmentos=56)
    borde.toro(1.585, 0.028, (0, 0, 0.375), 56, 6)
    fondo.cilindro(1.405, 0.01, (0, 0, 0.195), 56)
    agua.cilindro(1.4, 0.01, (0, 0, 0.395), 56)

    # pie torneado y taza grande
    piedra.revolucion([
        (0, 0.19), (0.42, 0.19), (0.42, 0.28), (0.30, 0.36), (0.25, 0.50), (0.31, 0.60), (0.23, 0.72),
        (0.20, 0.92), (0.20, 1.02), (0, 1.02),
    ], segmentos=40)
    borde.revolucion([
        (0, 1.00), (0.21, 1.00), (0.32, 1.05), (0.54, 1.11), (0.72, 1.20), (0.80, 1.28), (0.80, 1.34),
        (0.76, 1.38), (0.69, 1.38), (0.66, 1.32), (0.64, 1.27), (0, 1.27),
    ], segmentos=48)
    fondo.cilindro(0.64, 0.01, (0, 0, 1.275), 40)
    agua.cilindro(0.655, 0.01, (0, 0, 1.32), 40)
    metal.toro(0.215, 0.026, (0, 0, 0.97), 28, 6)

    # columna y taza pequeña
    piedra.revolucion([(0, 1.27), (0.17, 1.27), (0.12, 1.38), (0.12, 1.46), (0.15, 1.52), (0, 1.52)], segmentos=24)
    borde.revolucion([
        (0, 1.50), (0.13, 1.50), (0.20, 1.56), (0.31, 1.63), (0.34, 1.69), (0.34, 1.71), (0.30, 1.71),
        (0.27, 1.66), (0.25, 1.64), (0, 1.64),
    ], segmentos=40)
    agua.cilindro(0.265, 0.01, (0, 0, 1.65), 32)
    metal.revolucion([(0, 1.64), (0.07, 1.64), (0.05, 1.70), (0.025, 1.73), (0, 1.73)], segmentos=16)

    # agua que cae: dos cortinas por los bordes de las tazas, un chorro central y ocho arcos que caen en la taza grande
    chorro.revolucion([(0.845, 0.40), (0.815, 1.33)], segmentos=48)
    chorro.revolucion([(0.375, 1.32), (0.352, 1.70)], segmentos=32)
    chorro.segmento((0, 0, 1.72), (0, 0, 1.94), 0.026, 0.012, 6)
    for index in range(8):
        angulo = (index + 0.5) * math.tau / 8
        puntos = []
        for paso in range(7):
            t = paso / 6
            radio = 0.05 + 0.53 * t
            puntos.append((math.cos(angulo) * radio, math.sin(angulo) * radio, 1.72 + (1.33 - 1.72) * t + 0.27 * 4 * t * (1 - t)))
        for inicio, fin in zip(puntos, puntos[1:]):
            chorro.segmento(inicio, fin, 0.014, 0.014, 5)

    for group in (piedra, borde, fondo, agua, chorro, metal):
        group.crear(suavizar=True)
    exportar("fuente")


def arbol():
    reiniciar()
    corteza = Grupo("corteza", material("Corteza", "594333", 0.96))
    hojas = [
        Grupo("hojas_oliva", material("HojasOliva", "557744", 0.94)),
        Grupo("hojas_luz", material("HojasLuz", "708c4e", 0.94)),
        Grupo("hojas_sombra", material("HojasSombra", "3e663d", 0.96)),
    ]

    trunk = [
        ((0, 0, 0), (0.015, 0.0, 1.25), 0.23, 0.19),
        ((0.015, 0.0, 1.25), (-0.04, 0.025, 2.45), 0.19, 0.125),
        ((-0.04, 0.025, 2.45), (0.03, 0.02, 3.65), 0.125, 0.055),
        ((0.015, 0.0, 1.1), (-0.55, -0.12, 2.45), 0.13, 0.065),
        ((-0.55, -0.12, 2.45), (-1.0, -0.18, 3.15), 0.065, 0.025),
        ((-0.02, 0.0, 1.65), (0.65, -0.1, 2.75), 0.12, 0.06),
        ((0.65, -0.1, 2.75), (1.0, -0.16, 3.35), 0.06, 0.025),
        ((0.0, 0.02, 2.0), (0.05, 0.58, 2.95), 0.1, 0.045),
        ((0.05, 0.58, 2.95), (0.12, 0.9, 3.5), 0.045, 0.02),
        ((0.0, 0.0, 2.2), (-0.08, -0.62, 3.05), 0.09, 0.04),
        ((-0.08, -0.62, 3.05), (-0.15, -0.92, 3.55), 0.04, 0.018),
        ((-0.04, 0.025, 2.6), (-0.48, 0.45, 3.32), 0.07, 0.035),
        ((-0.48, 0.45, 3.32), (-0.78, 0.63, 3.75), 0.035, 0.015),
        ((-0.01, 0.02, 2.8), (0.5, 0.5, 3.45), 0.065, 0.03),
        ((0.5, 0.5, 3.45), (0.78, 0.75, 3.8), 0.03, 0.014),
    ]
    for start, end, thick, thin in trunk:
        corteza.segmento(start, end, thick, thin, 9)

    crowns = [
        (-0.95, -0.2, 3.25, 0.67), (-0.7, -0.55, 3.62, 0.65),
        (-0.55, 0.2, 3.55, 0.72), (-0.52, 0.55, 3.85, 0.62),
        (-0.15, -0.72, 3.55, 0.62), (0.1, -0.45, 3.95, 0.72),
        (0.38, -0.8, 3.45, 0.6), (0.75, -0.45, 3.55, 0.68),
        (0.94, 0.05, 3.8, 0.65), (0.63, 0.25, 4.08, 0.72),
        (-0.1, 0.42, 4.12, 0.7), (-0.7, 0.05, 4.05, 0.67),
        (-0.4, -0.1, 4.48, 0.68), (0.25, -0.1, 4.55, 0.7),
        (0.38, 0.62, 3.68, 0.62), (-0.2, 0.78, 3.55, 0.58),
    ]
    for index, (x, y, z, radius) in enumerate(crowns):
        hojas[index % len(hojas)].esfera(
            radius, (x, y, z),
            (1.0 + (index % 3) * 0.08, 0.92 + (index % 2) * 0.12, 0.82 + (index % 4) * 0.06),
            2, 0.16,
        )
    corteza.crear(suavizar=True)
    for group in hojas:
        group.crear(suavizar=True)
    exportar("arbol")


def farola():
    reiniciar()
    hierro = Grupo("hierro_forjado", material("HierroForjado", "30343a", 0.36, 0.72))
    cristal = Grupo("cristal_lampara", material("CristalLechoso", "e8d6a5", 0.24, 0.12))

    hierro.cilindro(0.34, 0.12, (0, 0, 0.06), 24, 0.27)
    hierro.cilindro(0.2, 0.28, (0, 0, 0.24), 20, 0.1)
    hierro.cilindro(0.085, 3.3, (0, 0, 2.0), 16, 0.055)
    hierro.cilindro(0.11, 0.09, (0, 0, 3.65), 16, 0.08)
    hierro.segmento((0, 0, 3.65), (0.0, 0, 4.08), 0.065, 0.05, 12)
    hierro.segmento((0, 0, 4.08), (0.35, 0, 4.35), 0.05, 0.04, 12)
    hierro.segmento((0.35, 0, 4.35), (0.72, 0, 4.35), 0.04, 0.04, 12)
    hierro.segmento((0.72, 0, 4.35), (0.82, 0, 4.14), 0.04, 0.035, 12)
    hierro.cilindro(0.11, 0.08, (0.82, 0, 4.11), 16, 0.19)
    cristal.cilindro(0.16, 0.34, (0.82, 0, 3.9), 12, 0.12)
    hierro.cilindro(0.22, 0.09, (0.82, 0, 3.71), 16, 0.12)
    hierro.toro(0.17, 0.025, (0.82, 0, 3.9), 16, 8)
    hierro.esfera(0.1, (0.82, 0, 4.22), (1.6, 1.2, 0.5), 1)

    hierro.crear(suavizar=True)
    cristal.crear(suavizar=True)
    exportar("farola")


def sol():
    reiniciar()
    esfera = Grupo("disco_solar", material("LuzSolar", "ffd36a", 0.24, 0.08))
    corona = Grupo("corona_solar", material("CoronaSolar", "ffad45", 0.38, 0.22))
    esfera.esfera(1.55, (0, 0, 0), subdivisiones=4)
    corona.toro(1.78, 0.07, (0, 0, 0), 48, 10)
    for index in range(16):
        angle = math.tau * index / 16
        start = (math.cos(angle) * 1.95, math.sin(angle) * 1.95, 0)
        end = (math.cos(angle) * (2.3 if index % 2 == 0 else 2.12), math.sin(angle) * (2.3 if index % 2 == 0 else 2.12), 0)
        corona.segmento(start, end, 0.045, 0.012, 6)
    esfera.crear(suavizar=True)
    corona.crear(suavizar=True)
    exportar("sol")


def luna_variante(nombre, fraccion):
    reiniciar()
    superficie = Grupo("regolito_oscuro", material("RegolitoOscuro", "343b49", 0.94, 0.0))
    crateres = Grupo("crateres_sombra", material("CráteresSombra", "202735", 0.96, 0.0))
    luz = Grupo("hemisferio_iluminado", material("RegolitoIluminado", "e8e9e7", 0.82, 0.0))
    relieve = Grupo("crateres_iluminados", material("CráteresIluminados", "9ea5aa", 0.91, 0.0))
    radio = 1.4
    superficie.esfera(radio, (0, 0, 0), subdivisiones=4, irregularidad=0.012)

    # Cuatro vistas de la esfera comparten el relieve; se ilumina la región que ve el sol en cada fase.
    esfera = bmesh.new()
    bmesh.ops.create_icosphere(esfera, subdivisions=5, radius=radio * 1.006)
    esfera.normal_update()
    angulo = (fraccion - 0.5) * math.tau
    sol_local = Vector((math.sin(angulo), -math.cos(angulo), 0))
    conservar = [
        cara for cara in esfera.faces
        if cara.normal.dot(Vector((0, -1, 0))) <= 0.015 or cara.normal.dot(sol_local) <= 0.0
    ]
    bmesh.ops.delete(esfera, geom=conservar, context="FACES")
    esfera.normal_update()
    malla_luz = bpy.data.meshes.new("hemisferio_iluminado")
    esfera.to_mesh(malla_luz)
    esfera.free()
    if malla_luz.polygons:
        malla_luz.materials.append(luz.mat)
        objeto_luz = bpy.data.objects.new("hemisferio_iluminado", malla_luz)
        for poligono in malla_luz.polygons:
            poligono.use_smooth = True
        bpy.context.scene.collection.objects.link(objeto_luz)
    else:
        bpy.data.meshes.remove(malla_luz)

    crateres.esfera(0.24, (-0.48, -1.29, 0.52), (1.0, 0.12, 0.82), 2)
    crateres.esfera(0.18, (0.43, -1.34, 0.72), (1.0, 0.1, 0.78), 2)
    crateres.esfera(0.3, (0.25, -1.24, -0.43), (1.0, 0.12, 0.75), 2)
    crateres.esfera(0.14, (-0.72, -1.17, -0.3), (1.0, 0.1, 0.8), 2)
    crateres.esfera(0.11, (0.72, -1.17, 0.0), (1.0, 0.1, 0.8), 2)
    for index in range(18):
        angle_crater = index * 2.399963
        distance = 0.35 + (index % 4) * 0.18
        x = math.cos(angle_crater) * distance
        z = math.sin(angle_crater) * distance
        normal = Vector((x, -math.sqrt(max(0.08, radio * radio - x * x - z * z)), z)).normalized()
        if normal.dot(Vector((0, -1, 0))) <= 0 or normal.dot(sol_local) <= 0:
            continue
        y = normal.y * radio - 0.012
        size = 0.045 + (index % 3) * 0.018
        relieve.esfera(size, (x, y, z), (1, 0.14, 0.82), 1)
    superficie.crear(suavizar=True)
    crateres.crear(suavizar=True)
    relieve.crear(suavizar=True)
    exportar(nombre)


def luna():
    luna_variante("luna", 0.5)


def luna_nueva():
    luna_variante("luna_nueva", 0.0)


def luna_creciente():
    luna_variante("luna_creciente", 0.25)


def luna_llena():
    luna_variante("luna_llena", 0.5)


def luna_menguante():
    luna_variante("luna_menguante", 0.75)


PRODUCTOS = {"banco": banco, "fachada": fachada, "interior": interior, "fuente": fuente, "arbol": arbol, "farola": farola, "sol": sol, "luna": luna, "luna_nueva": luna_nueva, "luna_creciente": luna_creciente, "luna_llena": luna_llena, "luna_menguante": luna_menguante}

if __name__ == "__main__":
    argumentos = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    for nombre in argumentos or list(PRODUCTOS):
        PRODUCTOS[nombre]()
