"""Genera los modelos de los edificios (muebles, puertas, ventanas, escalera, ascensor, portales y locales) en public/models/mundo/.

Uso (desde la raíz del proyecto):
  blender.exe --background --python tools/blender/crear_interiores.py
  blender.exe --background --python tools/blender/crear_interiores.py -- sofa cama_doble   (solo esos)

Las medidas de la huella de cada mueble (ancho en X, fondo en Y) deben coincidir con FURNITURE en src/world/buildingPlan.ts:
el plano coloca los muebles con ellas. Mismas convenciones que crear_props.py (de donde salen las utilidades):
- el frente mira hacia -Y; el origen es el centro de la huella, a ras de suelo; en metros; sin texturas;
- COL_* caja de colisión, SEAT_* plaza (mira hacia su frente), PUERTA_HOJA (gira sobre su origen, la bisagra; abre
  hacia +Y, el lado de atrás), PUERTA_CORREDERA_I / _D (se desliza hacia -X o +X);
- los materiales se llaman igual en todos los modelos para que el navegador fusione los muebles de una planta por
  material. «Bombilla» brilla (lo pone el código) y los «Rotulo*» también.
Todo se hace por código, sin nada de terceros: dominio público (CC0).
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crear_props import Grupo, colision, exportar, material, reiniciar, vacio  # noqa: E402

# --------------------------------------------------------------------------- materiales compartidos


def M(nombre):
    colores = {
        "Madera": ("8a6a45", 0.7),
        "MaderaClara": ("c49a6c", 0.6),
        "MaderaOscura": ("4a3524", 0.65),
        "Lacado": ("f0eee8", 0.45),
        "Gris": ("9ea2a3", 0.6),
        "Negro": ("1c1d1f", 0.45),
        "Pantalla": ("0b0e12", 0.12),
        "TelaSofa": ("6d7c88", 0.95),
        "TelaGris": ("9a948b", 0.95),
        "Cojin": ("c9a26a", 0.95),
        "Sabana": ("ece8de", 0.9),
        "Edredon": ("7b92a8", 0.92),
        "Almohada": ("f5f2ea", 0.9),
        "Ceramica": ("f6f6f2", 0.12),
        "Encimera": ("3a3936", 0.3),
        "Marmol": ("e6e1d6", 0.25),
        "Verde": ("4d7b38", 0.85),
        "VerdeOscuro": ("365a2a", 0.85),
        "Maceta": ("a35d3c", 0.8),
        "Tierra": ("3d2c20", 1.0),
        "Alfombra": ("a8856a", 1.0),
        "AlfombraBorde": ("5f3f2e", 1.0),
        "Felpudo": ("6b5944", 1.0),
        "PuertaInterior": ("f2efe8", 0.45),
        "PuertaPiso": ("5a3a27", 0.55),
        "Pvc": ("f3f3f0", 0.4),
        "Persiana": ("d8d3c6", 0.6),
        "Peldano": ("d8d0c2", 0.35),
        "Losa": ("e8e3da", 0.9),
        "Placa": ("b8963e", 0.35),
        "PlacaAzul": ("27508f", 0.4),
        "Cuero": ("252120", 0.5),
        "Deposito": ("d9d9d2", 0.6),
        "Pan": ("c4893f", 0.85),
        "PanOscuro": ("8a5528", 0.85),
        "LibroRojo": ("8c3b32", 0.8),
        "LibroAzul": ("34506e", 0.8),
        "LibroVerde": ("4e6b45", 0.8),
        "LibroOcre": ("b08a3c", 0.8),
        "CajaRoja": ("b8463a", 0.7),
        "CajaAmarilla": ("d9b23f", 0.7),
        "CajaAzul": ("3f6fb0", 0.7),
        "CajaBlanca": ("eceae4", 0.6),
        "CajaVerde": ("3f9a5a", 0.6),
        "Botella": ("5c8f5a", 0.2),
        "Ropa1": ("c0504d", 0.95),
        "Ropa2": ("e0d7c3", 0.95),
        "Ropa3": ("4f6d9a", 0.95),
        "Lienzo1": ("d0a050", 0.8),
        "Lienzo2": ("5a7f9a", 0.8),
        "Bombilla": ("fff3d6", 0.4),
        "Letras": ("f7f3e6", 0.5),
        "RotuloRojo": ("a8322b", 0.5),
        "RotuloVerde": ("1f9a4a", 0.4),
        "RotuloOcre": ("9b6a2a", 0.5),
        "RotuloAzul": ("2a4f86", 0.5),
    }
    if nombre == "Hierro":
        return material("Hierro", "2e3033", 0.55, 0.6)
    if nombre == "Cromo":
        return material("Cromo", "c9cdd1", 0.18, 1.0)
    if nombre == "Inox":
        return material("Inox", "bfc3c6", 0.32, 0.85)
    if nombre == "Aluminio":
        return material("Aluminio", "a7abaf", 0.35, 0.8)
    if nombre == "Espejo":
        return material("Espejo", "dfe7ea", 0.03, 1.0)
    if nombre == "Cristal":
        return material("Cristal", "a8c6d0", 0.05, alfa=0.25)
    color, rugosidad = colores[nombre]
    return material(nombre, color, rugosidad)


class Piezas:
    """Un Grupo por material, creado al usarlo: p["Madera"].caja(...)."""

    def __init__(self, prefijo):
        self.prefijo = prefijo
        self.grupos = {}

    def __getitem__(self, nombre):
        if nombre not in self.grupos:
            self.grupos[nombre] = Grupo(f"{self.prefijo}_{nombre}", M(nombre))
        return self.grupos[nombre]

    def crear(self):
        for grupo in self.grupos.values():
            grupo.crear()


def girar(x, y, grados):
    a = math.radians(grados)
    return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)


def silla(p, cx, cy, giro, asiento="TelaGris", madera="Madera", alto=0.45):
    """Silla de comedor mirando hacia `giro` (0 = hacia -Y), con el centro del asiento en (cx, cy)."""

    def put(mat, tam, x, y, z):
        dx, dy = girar(x, y, giro)
        p[mat].caja(tam, (cx + dx, cy + dy, z), (0, 0, giro), bisel=0.005)

    put(asiento, (0.44, 0.42, 0.05), 0, -0.01, alto)
    for sx in (-0.19, 0.19):
        for sy in (-0.18, 0.18):
            put(madera, (0.035, 0.035, alto - 0.02), sx, sy, (alto - 0.02) / 2)
        put(madera, (0.035, 0.035, 0.5), sx, 0.2, alto + 0.24)
    put(madera, (0.42, 0.03, 0.3), 0, 0.2, alto + 0.32)
    put(madera, (0.38, 0.025, 0.05), 0, 0.2, alto + 0.12)


def patas(p, mat, ancho, fondo, alto, grosor=0.04, margen=0.05, cy=0.0):
    for sx in (-1, 1):
        for sy in (-1, 1):
            p[mat].caja((grosor, grosor, alto), (sx * (ancho / 2 - margen), cy + sy * (fondo / 2 - margen), alto / 2))


def texto(cadena, tamano, ubicacion, nombre_material, nombre="letras"):
    """Letras en relieve, de pie y legibles desde el frente (-Y)."""
    curva = bpy.data.curves.new(nombre + "_curva", "FONT")
    curva.body = cadena
    curva.size = tamano
    curva.extrude = 0.01
    curva.align_x = "CENTER"
    curva.align_y = "CENTER"
    objeto = bpy.data.objects.new(nombre, curva)
    objeto.location = ubicacion
    objeto.rotation_euler = (math.radians(90), 0, 0)
    objeto.data.materials.append(M(nombre_material))
    bpy.context.scene.collection.objects.link(objeto)
    bpy.context.view_layer.objects.active = objeto
    for o in bpy.context.scene.objects:
        o.select_set(o == objeto)
    bpy.ops.object.convert(target="MESH")


def hoja(partes, bisagra, nombre="PUERTA_HOJA"):
    """Hoja de puerta hecha de varios materiales: la primera parte es la hoja (con su origen en la bisagra) y el resto se
    cuelga de ella para girar con ella. `partes` es una lista de (material, [(tamaño, centro), ...])."""
    principal = None
    for i, (mat, cajas) in enumerate(partes):
        grupo = Grupo(nombre if i == 0 else f"PUERTA_PIEZA_{i}", M(mat))
        for tam, centro in cajas:
            grupo.caja(tam, centro, bisel=0.004)
        objeto = grupo.crear(origen=bisagra)
        if objeto is None:
            continue
        if principal is None:
            principal = objeto
            objeto.name = nombre
        else:
            objeto.parent = principal
            objeto.location = (0, 0, 0)
    return principal


# --------------------------------------------------------------------------- salón y comedor


def sofa():
    reiniciar()
    p = Piezas("sofa")
    p["TelaSofa"].caja((2.1, 0.86, 0.24), (0, 0.01, 0.24), bisel=0.03)  # cuerpo
    p["TelaSofa"].caja((2.1, 0.2, 0.5), (0, 0.36, 0.55), bisel=0.05)  # respaldo
    for x in (-0.98, 0.98):
        p["TelaSofa"].caja((0.15, 0.88, 0.32), (x, 0.01, 0.5), bisel=0.05)  # brazos
    for x in (-0.62, 0, 0.62):
        p["TelaSofa"].caja((0.62, 0.62, 0.13), (x, -0.07, 0.42), bisel=0.045)  # asientos
        p["TelaSofa"].caja((0.6, 0.17, 0.38), (x, 0.22, 0.66), (-12, 0, 0), bisel=0.06)  # cojines del respaldo
    p["Cojin"].caja((0.36, 0.11, 0.36), (-0.66, 0.1, 0.66), (-15, 0, 12), bisel=0.05)
    p["Cojin"].caja((0.36, 0.11, 0.36), (0.66, 0.1, 0.66), (-15, 0, -12), bisel=0.05)
    patas(p, "MaderaOscura", 2.0, 0.78, 0.12, 0.05)
    p.crear()
    colision("sofa", (0, 0, 0.42), (2.1, 0.92, 0.84))
    for i, x in enumerate((-0.62, 0, 0.62)):
        vacio(f"SEAT_{i}", (x, -0.06, 0.46), tipo="ARROWS")
    exportar("sofa")


def sillon():
    reiniciar()
    p = Piezas("sillon")
    p["TelaSofa"].caja((0.9, 0.84, 0.24), (0, 0.01, 0.24), bisel=0.03)
    p["TelaSofa"].caja((0.9, 0.2, 0.52), (0, 0.34, 0.56), bisel=0.05)
    for x in (-0.38, 0.38):
        p["TelaSofa"].caja((0.14, 0.84, 0.3), (x, 0.01, 0.5), bisel=0.05)
    p["TelaSofa"].caja((0.62, 0.6, 0.13), (0, -0.06, 0.42), bisel=0.045)
    p["Cojin"].caja((0.38, 0.11, 0.38), (0, 0.2, 0.66), (-14, 0, 0), bisel=0.05)
    patas(p, "MaderaOscura", 0.8, 0.74, 0.12, 0.05)
    p.crear()
    colision("sillon", (0, 0, 0.42), (0.9, 0.88, 0.84))
    vacio("SEAT_0", (0, -0.05, 0.46), tipo="ARROWS")
    exportar("sillon")


def mesa_baja():
    reiniciar()
    p = Piezas("mesa_baja")
    p["MaderaClara"].caja((1.1, 0.6, 0.04), (0, 0, 0.4), bisel=0.01)
    p["MaderaClara"].caja((1.0, 0.5, 0.02), (0, 0, 0.12))
    patas(p, "Negro", 1.1, 0.6, 0.38, 0.035, 0.04)
    p["LibroAzul"].caja((0.26, 0.19, 0.04), (-0.25, 0.05, 0.44), (0, 0, 8))
    p["LibroOcre"].caja((0.22, 0.16, 0.03), (-0.25, 0.05, 0.475), (0, 0, -6))
    p["Ceramica"].cilindro(0.06, 0.18, (0.3, -0.05, 0.51), 14, 0.04)
    p.crear()
    colision("mesa", (0, 0, 0.21), (1.1, 0.6, 0.42))
    exportar("mesa_baja")


def mueble_tv():
    reiniciar()
    p = Piezas("mueble_tv")
    p["Lacado"].caja((1.8, 0.45, 0.46), (0, 0, 0.29), bisel=0.01)
    for x in (-0.6, 0, 0.6):
        p["MaderaClara"].caja((0.58, 0.01, 0.4), (x, -0.226, 0.29))  # frentes
        p["Cromo"].caja((0.16, 0.02, 0.015), (x, -0.235, 0.44))
    patas(p, "Negro", 1.7, 0.4, 0.06, 0.04)
    # televisor de 55" sobre su pie
    p["Negro"].caja((1.25, 0.05, 0.73), (0, 0.06, 0.94), bisel=0.008)
    p["Pantalla"].caja((1.2, 0.01, 0.68), (0, 0.032, 0.94))
    p["Negro"].caja((0.06, 0.05, 0.1), (0, 0.06, 0.55))
    p["Negro"].caja((0.36, 0.2, 0.02), (0, 0.06, 0.53))
    p["Gris"].caja((0.42, 0.12, 0.08), (0.62, 0.04, 0.56), bisel=0.01)  # equipo
    p.crear()
    colision("mueble", (0, 0, 0.6), (1.8, 0.45, 1.2))
    exportar("mueble_tv")


def estanteria():
    reiniciar()
    p = Piezas("estanteria")
    for x in (-0.49, 0.49):
        p["MaderaClara"].caja((0.02, 0.35, 1.9), (x, 0, 0.95))
    p["MaderaClara"].caja((1.0, 0.01, 1.9), (0, 0.17, 0.95))
    libros = ["LibroRojo", "LibroAzul", "LibroVerde", "LibroOcre"]
    for k, z in enumerate((0.02, 0.4, 0.78, 1.16, 1.54, 1.89)):
        p["MaderaClara"].caja((0.96, 0.33, 0.02), (0, 0, z))
        if k >= 5:
            continue
        x = -0.45
        i = k * 3
        while x < 0.42:
            ancho = 0.03 + ((i * 7) % 5) * 0.008
            alto = 0.22 + ((i * 5) % 4) * 0.03
            if (i + k) % 9 != 4:
                p[libros[i % 4]].caja((ancho, 0.22, alto), (x + ancho / 2, 0.02, z + 0.01 + alto / 2))
            x += ancho + 0.004
            i += 1
    p.crear()
    colision("estanteria", (0, 0, 0.95), (1.0, 0.35, 1.9))
    exportar("estanteria")


def alfombra():
    reiniciar()
    p = Piezas("alfombra")
    p["Alfombra"].caja((1.84, 1.24, 0.012), (0, 0, 0.006))
    for dx, dy, sx, sy in ((0, 0.66, 2.0, 0.08), (0, -0.66, 2.0, 0.08), (0.96, 0, 0.08, 1.24), (-0.96, 0, 0.08, 1.24)):
        p["AlfombraBorde"].caja((sx, sy, 0.012), (dx, dy, 0.006))
    p.crear()
    exportar("alfombra")


def lampara_pie():
    reiniciar()
    p = Piezas("lampara_pie")
    p["Negro"].cilindro(0.16, 0.03, (0, 0, 0.015), 20)
    p["Negro"].cilindro(0.014, 1.42, (0, 0, 0.74), 8)
    p["Bombilla"].cilindro(0.2, 0.3, (0, 0, 1.5), 20, 0.13)
    p.crear()
    colision("lampara", (0, 0, 0.82), (0.36, 0.36, 1.65))
    exportar("lampara_pie")


def comedor():
    reiniciar()
    p = Piezas("comedor")
    p["Madera"].caja((1.6, 0.9, 0.04), (0, 0, 0.74), bisel=0.01)
    p["Madera"].caja((1.44, 0.74, 0.08), (0, 0, 0.68))
    patas(p, "Madera", 1.6, 0.9, 0.7, 0.06, 0.08)
    plazas = []
    for x in (-0.4, 0.4):
        for y, giro in ((-0.72, 180), (0.72, 0)):
            silla(p, x, y, giro)
            plazas.append((x, y, giro))
    p["Ceramica"].cilindro(0.13, 0.08, (0, 0, 0.8), 18, 0.09)  # frutero
    p.crear()
    colision("mesa", (0, 0, 0.38), (1.6, 0.9, 0.76))
    for i, (x, y, giro) in enumerate(plazas):
        colision(f"silla{i}", (x, y, 0.45), (0.48, 0.48, 0.9))
        vacio(f"SEAT_{i}", (x, y, 0.47), giro_z=giro, tipo="ARROWS")
    exportar("comedor")


def silla_suelta():
    reiniciar()
    p = Piezas("silla")
    silla(p, 0, 0, 0)
    p.crear()
    colision("silla", (0, 0, 0.45), (0.46, 0.5, 0.9))
    vacio("SEAT_0", (0, -0.02, 0.47), tipo="ARROWS")
    exportar("silla")


# --------------------------------------------------------------------------- cocina


def mueble_bajo(p, frente=True):
    p["Negro"].caja((0.58, 0.5, 0.08), (0, 0.04, 0.04))  # zócalo
    p["Lacado"].caja((0.6, 0.58, 0.8), (0, 0.02, 0.48), bisel=0.004)
    p["Encimera"].caja((0.6, 0.62, 0.04), (0, 0, 0.9))
    if frente:
        p["Lacado"].caja((0.57, 0.02, 0.76), (0, -0.28, 0.48), bisel=0.003)
        p["Inox"].caja((0.2, 0.025, 0.015), (0, -0.3, 0.8))


def cocina_bajo():
    reiniciar()
    p = Piezas("cocina_bajo")
    mueble_bajo(p)
    p.crear()
    colision("mueble", (0, 0, 0.46), (0.6, 0.62, 0.92))
    exportar("cocina_bajo")


def cocina_fregadero():
    reiniciar()
    p = Piezas("cocina_fregadero")
    mueble_bajo(p)
    p["Inox"].caja((0.46, 0.4, 0.01), (0, -0.02, 0.922))
    p["Negro"].caja((0.4, 0.34, 0.004), (0, -0.02, 0.927))  # el seno
    p["Cromo"].segmento((0, 0.2, 0.92), (0, 0.2, 1.2), 0.016, 0.014, 10)
    p["Cromo"].segmento((0, 0.2, 1.2), (0, 0.02, 1.16), 0.013, 0.012, 10)
    p.crear()
    colision("mueble", (0, 0, 0.46), (0.6, 0.62, 0.92))
    exportar("cocina_fregadero")


def cocina_placa():
    reiniciar()
    p = Piezas("cocina_placa")
    mueble_bajo(p, frente=False)
    p["Negro"].caja((0.56, 0.5, 0.006), (0, -0.01, 0.923))
    for x, y, r in ((-0.13, -0.12, 0.09), (0.13, -0.12, 0.07), (-0.13, 0.12, 0.07), (0.13, 0.12, 0.09)):
        p["Gris"].cilindro(r, 0.002, (x, y, 0.927), 20)
    p["Inox"].caja((0.57, 0.02, 0.12), (0, -0.28, 0.79))
    p["Negro"].caja((0.54, 0.02, 0.48), (0, -0.285, 0.46))  # puerta del horno
    p["Inox"].caja((0.42, 0.03, 0.02), (0, -0.3, 0.66))
    p.crear()
    colision("mueble", (0, 0, 0.46), (0.6, 0.62, 0.92))
    exportar("cocina_placa")


def frigorifico():
    reiniciar()
    p = Piezas("frigorifico")
    p["Inox"].caja((0.6, 0.64, 1.84), (0, 0.01, 0.92), bisel=0.02)
    p["Negro"].caja((0.58, 0.01, 0.01), (0, -0.315, 1.2))  # junta entre puertas
    for z0, z1 in ((0.25, 0.95), (1.35, 1.75)):
        p["Cromo"].caja((0.025, 0.04, z1 - z0), (0.24, -0.34, (z0 + z1) / 2))
    p.crear()
    colision("frigorifico", (0, 0, 0.92), (0.6, 0.66, 1.85))
    exportar("frigorifico")


def cocina_alto():
    reiniciar()
    p = Piezas("cocina_alto")
    p["Lacado"].caja((0.6, 0.35, 0.7), (0, 0, 1.8), bisel=0.004)
    p["Inox"].caja((0.2, 0.025, 0.015), (0, -0.185, 1.5))
    p.crear()
    exportar("cocina_alto")


def campana():
    reiniciar()
    p = Piezas("campana")
    p["Inox"].caja((0.6, 0.5, 0.08), (0, 0, 1.66), bisel=0.01)
    p["Inox"].caja((0.32, 0.26, 0.42), (0, 0.11, 1.95), bisel=0.01)
    p["Inox"].caja((0.24, 0.2, 0.4), (0, 0.14, 2.35))
    p.crear()
    exportar("campana")


def mesa_cocina():
    reiniciar()
    p = Piezas("mesa_cocina")
    p["Lacado"].caja((1.0, 0.6, 0.03), (0, 0.275, 0.74), bisel=0.008)
    patas(p, "Cromo", 1.0, 0.6, 0.72, 0.03, 0.05, cy=0.275)
    plazas = []
    for x in (-0.25, 0.25):
        silla(p, x, -0.22, 180, asiento="Lacado", madera="Cromo")
        plazas.append((x, -0.22))
    p.crear()
    colision("mesa", (0, 0.275, 0.38), (1.0, 0.6, 0.76))
    for i, (x, y) in enumerate(plazas):
        colision(f"silla{i}", (x, y, 0.45), (0.46, 0.46, 0.9))
        vacio(f"SEAT_{i}", (x, y, 0.47), giro_z=180, tipo="ARROWS")
    exportar("mesa_cocina")


# --------------------------------------------------------------------------- dormitorio


def cama(ancho, largo, nombre, almohadas):
    reiniciar()
    p = Piezas(nombre)
    atras = largo / 2
    p["Madera"].caja((ancho, largo - 0.05, 0.22), (0, -0.025, 0.2), bisel=0.01)
    patas(p, "Madera", ancho, largo - 0.05, 0.1, 0.05, 0.05, cy=-0.025)
    p["Sabana"].caja((ancho - 0.1, largo - 0.12, 0.22), (0, -0.04, 0.42), bisel=0.05)
    p["Edredon"].caja((ancho - 0.04, largo * 0.68, 0.06), (0, -largo * 0.14, 0.55), bisel=0.03)
    p["Edredon"].caja((ancho - 0.04, 0.05, 0.3), (0, -largo / 2 + 0.04, 0.4), bisel=0.02)  # cae por los pies
    for x in almohadas:
        p["Almohada"].caja((0.56 if len(almohadas) > 1 else 0.7, 0.34, 0.13), (x, atras - 0.32, 0.6), (-8, 0, 0), bisel=0.06)
    p["Madera"].caja((ancho + 0.04, 0.06, 1.0), (0, atras - 0.03, 0.5), bisel=0.01)  # cabecero
    p.crear()
    colision("cama", (0, 0, 0.3), (ancho, largo, 0.6))
    vacio("SEAT_0", (0, -largo / 2 + 0.22, 0.5), tipo="ARROWS")
    exportar(nombre)


def cama_doble():
    cama(1.6, 2.05, "cama_doble", (-0.38, 0.38))


def cama_individual():
    cama(0.95, 2.0, "cama_individual", (0,))


def mesita():
    reiniciar()
    p = Piezas("mesita")
    p["MaderaClara"].caja((0.45, 0.4, 0.46), (0, 0, 0.29), bisel=0.008)
    patas(p, "MaderaClara", 0.42, 0.36, 0.06, 0.03, 0.03)
    p["Lacado"].caja((0.41, 0.01, 0.17), (0, -0.2, 0.38))
    p["Cromo"].caja((0.08, 0.02, 0.012), (0, -0.21, 0.38))
    p["Cromo"].cilindro(0.06, 0.02, (0.08, 0.05, 0.53), 14)
    p["Cromo"].cilindro(0.01, 0.2, (0.08, 0.05, 0.63), 8)
    p["Bombilla"].cilindro(0.11, 0.15, (0.08, 0.05, 0.78), 18, 0.07)
    p.crear()
    colision("mesita", (0, 0, 0.27), (0.45, 0.4, 0.55))
    exportar("mesita")


def armario():
    reiniciar()
    p = Piezas("armario")
    p["MaderaClara"].caja((1.2, 0.58, 2.06), (0, 0.01, 1.07), bisel=0.008)
    p["Negro"].caja((1.16, 0.5, 0.04), (0, 0.03, 0.02))
    for x in (-0.3, 0.3):
        p["MaderaClara"].caja((0.58, 0.02, 1.98), (x, -0.285, 1.07), bisel=0.004)
    for x in (-0.04, 0.04):
        p["Cromo"].caja((0.015, 0.025, 0.3), (x, -0.305, 1.1))
    p.crear()
    colision("armario", (0, 0, 1.05), (1.2, 0.6, 2.1))
    exportar("armario")


def comoda():
    reiniciar()
    p = Piezas("comoda")
    p["Lacado"].caja((1.0, 0.46, 0.76), (0, 0.01, 0.46), bisel=0.008)
    patas(p, "MaderaClara", 0.96, 0.42, 0.08, 0.04, 0.04)
    for z in (0.22, 0.46, 0.7):
        p["Lacado"].caja((0.95, 0.01, 0.21), (0, -0.225, z))
        p["MaderaClara"].caja((0.24, 0.02, 0.02), (0, -0.235, z + 0.05))
    p["MaderaOscura"].caja((0.16, 0.02, 0.21), (0.3, 0.08, 0.95), (-12, 0, 0))  # marco de foto
    p["Ceramica"].cilindro(0.05, 0.16, (-0.32, 0.05, 0.92), 12)
    p.crear()
    colision("comoda", (0, 0, 0.42), (1.0, 0.48, 0.85))
    exportar("comoda")


def escritorio():
    reiniciar()
    p = Piezas("escritorio")
    p["MaderaClara"].caja((1.1, 0.6, 0.03), (0, 0.25, 0.745), bisel=0.006)
    p["Lacado"].caja((0.4, 0.55, 0.7), (0.33, 0.25, 0.37), bisel=0.006)  # cajonera
    p["Lacado"].caja((0.03, 0.56, 0.72), (-0.53, 0.25, 0.37))
    p["Gris"].caja((0.34, 0.24, 0.015), (-0.1, 0.22, 0.77), (0, 0, -5))  # portátil
    p["Negro"].caja((0.34, 0.01, 0.22), (-0.1, 0.34, 0.88), (-15, 0, -5))
    p["Negro"].cilindro(0.06, 0.02, (0.4, 0.4, 0.77), 12)
    p["Negro"].segmento((0.4, 0.4, 0.77), (0.33, 0.33, 1.1), 0.01, 0.01, 6)
    p["Bombilla"].cilindro(0.07, 0.08, (0.3, 0.3, 1.07), 14, 0.04)
    silla(p, 0, -0.22, 180, asiento="Negro", madera="Negro")
    p.crear()
    colision("mesa", (0, 0.25, 0.38), (1.1, 0.6, 0.76))
    colision("silla", (0, -0.22, 0.45), (0.46, 0.46, 0.9))
    vacio("SEAT_0", (0, -0.22, 0.47), giro_z=180, tipo="ARROWS")
    exportar("escritorio")


# --------------------------------------------------------------------------- baño


def inodoro():
    reiniciar()
    p = Piezas("inodoro")
    p["Ceramica"].cilindro(0.15, 0.38, (0, -0.06, 0.19), 20, 0.18)
    p["Ceramica"].caja((0.38, 0.46, 0.05), (0, -0.08, 0.41), bisel=0.03)  # tapa
    p["Ceramica"].caja((0.38, 0.17, 0.4), (0, 0.26, 0.6), bisel=0.02)  # cisterna
    p["Cromo"].cilindro(0.025, 0.01, (0, 0.26, 0.805), 12)
    p.crear()
    colision("inodoro", (0, 0, 0.4), (0.4, 0.7, 0.8))
    exportar("inodoro")


def lavabo():
    reiniciar()
    p = Piezas("lavabo")
    p["MaderaClara"].caja((0.6, 0.44, 0.5), (0, 0.02, 0.5), bisel=0.006)
    p["Ceramica"].caja((0.6, 0.48, 0.12), (0, 0, 0.84), bisel=0.03)
    p["Negro"].cilindro(0.025, 0.004, (0, -0.02, 0.902), 10)
    p["Cromo"].segmento((0, 0.18, 0.9), (0, 0.18, 1.05), 0.014, 0.012, 10)
    p["Cromo"].segmento((0, 0.18, 1.05), (0, 0.06, 1.02), 0.012, 0.01, 10)
    p["Espejo"].caja((0.6, 0.015, 0.75), (0, 0.232, 1.5))
    p["Lacado"].caja((0.64, 0.02, 0.79), (0, 0.235, 1.5))
    p["Bombilla"].caja((0.4, 0.06, 0.04), (0, 0.2, 1.92))
    p.crear()
    colision("lavabo", (0, 0, 0.45), (0.6, 0.48, 0.9))
    exportar("lavabo")


def ducha():
    reiniciar()
    p = Piezas("ducha")
    p["Ceramica"].caja((0.9, 0.9, 0.05), (0, 0, 0.025), bisel=0.01)
    p["Negro"].cilindro(0.04, 0.004, (0, 0, 0.051), 12)
    p["Cristal"].caja((0.55, 0.01, 1.9), (0.17, -0.445, 1.0))
    p["Cromo"].caja((0.02, 0.02, 1.9), (-0.11, -0.445, 1.0))
    p["Cromo"].caja((0.57, 0.02, 0.02), (0.17, -0.445, 1.95))
    p["Cromo"].segmento((0.3, 0.43, 0.9), (0.3, 0.43, 1.95), 0.012, 0.012, 8)
    p["Cromo"].segmento((0.3, 0.43, 1.95), (0.3, 0.3, 1.95), 0.012, 0.012, 8)
    p["Cromo"].cilindro(0.08, 0.02, (0.3, 0.3, 1.93), 16)
    p["Cromo"].caja((0.08, 0.04, 0.12), (0.3, 0.43, 1.05))
    p.crear()
    colision("ducha", (0, 0, 1.0), (0.9, 0.9, 2.0))
    exportar("ducha")


def banera():
    reiniciar()
    p = Piezas("banera")
    p["Ceramica"].caja((1.6, 0.72, 0.4), (0, 0, 0.2))
    for dx, dy, sx, sy in ((0, 0.31, 1.6, 0.1), (0, -0.31, 1.6, 0.1), (0.75, 0, 0.1, 0.72), (-0.75, 0, 0.1, 0.72)):
        p["Ceramica"].caja((sx, sy, 0.16), (dx, dy, 0.5), bisel=0.02)  # borde
    p["Cromo"].segmento((0.72, 0.2, 0.58), (0.72, 0.2, 0.7), 0.014, 0.012, 10)
    p["Cromo"].segmento((0.72, 0.2, 0.7), (0.62, 0.2, 0.68), 0.012, 0.01, 10)
    p.crear()
    colision("banera", (0, 0, 0.29), (1.6, 0.72, 0.58))
    exportar("banera")


# --------------------------------------------------------------------------- pequeños y comunes


def radiador():
    reiniciar()
    p = Piezas("radiador")
    for i in range(12):
        p["Lacado"].caja((0.055, 0.07, 0.56), (-0.36 + i * 0.065, 0, 0.42), bisel=0.01)
    p["Lacado"].caja((0.8, 0.03, 0.03), (0, 0.02, 0.17))
    p["Lacado"].caja((0.8, 0.03, 0.03), (0, 0.02, 0.67))
    p.crear()
    exportar("radiador")


def plafon():
    reiniciar()
    p = Piezas("plafon")
    p["Lacado"].cilindro(0.19, 0.02, (0, 0, 2.79), 24)
    p["Bombilla"].cilindro(0.17, 0.06, (0, 0, 2.75), 24, 0.15)
    p.crear()
    exportar("plafon")


def planta():
    reiniciar()
    p = Piezas("planta")
    p["Maceta"].cilindro(0.15, 0.34, (0, 0, 0.17), 16, 0.2)
    p["Tierra"].cilindro(0.18, 0.01, (0, 0, 0.335), 16)
    for i in range(7):
        a = i * 2.4
        r = 0.08 + (i % 3) * 0.04
        z = 0.55 + (i % 4) * 0.13
        p["Verde" if i % 2 else "VerdeOscuro"].esfera(0.16, (math.cos(a) * r, math.sin(a) * r, z), (1, 1, 1.3), 1, 0.12)
    p["Verde"].esfera(0.14, (0, 0, 0.98), (1, 1, 1.2), 1, 0.12)
    p.crear()
    colision("planta", (0, 0, 0.55), (0.4, 0.4, 1.1))
    exportar("planta")


def buzones():
    reiniciar()
    p = Piezas("buzones")
    p["Aluminio"].caja((1.2, 0.18, 0.78), (0, 0.01, 1.45), bisel=0.01)
    for fila in range(3):
        for col in range(4):
            x = -0.43 + col * 0.287
            z = 1.2 + fila * 0.24
            p["Gris"].caja((0.26, 0.01, 0.2), (x, -0.085, z))
            p["Negro"].caja((0.16, 0.012, 0.012), (x, -0.09, z + 0.06))
            p["Placa"].caja((0.08, 0.012, 0.025), (x, -0.09, z - 0.04))
    p.crear()
    colision("buzones", (0, 0, 0.95), (1.2, 0.2, 1.9))
    exportar("buzones")


def felpudo():
    reiniciar()
    p = Piezas("felpudo")
    p["Felpudo"].caja((0.9, 0.55, 0.015), (0, 0, 0.0075), bisel=0.004)
    p.crear()
    exportar("felpudo")


def cuadro():
    reiniciar()
    p = Piezas("cuadro")
    p["MaderaOscura"].caja((0.7, 0.03, 0.5), (0, 0.005, 1.6), bisel=0.005)
    p["Lienzo1"].caja((0.6, 0.01, 0.4), (0, -0.012, 1.6))
    p["Lienzo2"].caja((0.6, 0.012, 0.15), (0, -0.014, 1.5))
    p.crear()
    exportar("cuadro")


# --------------------------------------------------------------------------- locales


def mostrador():
    reiniciar()
    p = Piezas("mostrador")
    p["MaderaClara"].caja((1.8, 0.56, 1.0), (0, 0.02, 0.5), bisel=0.01)
    p["Encimera"].caja((1.84, 0.62, 0.04), (0, 0, 1.02))
    p["Negro"].caja((0.36, 0.3, 0.12), (0.5, 0.05, 1.1), bisel=0.01)  # caja registradora
    p["Pantalla"].caja((0.22, 0.02, 0.14), (0.5, 0.0, 1.24), (-20, 0, 0))
    p["Gris"].caja((1.78, 0.01, 0.12), (0, -0.265, 0.12))
    p.crear()
    colision("mostrador", (0, 0, 0.52), (1.8, 0.6, 1.05))
    exportar("mostrador")


def estanteria_tienda():
    reiniciar()
    p = Piezas("estanteria_tienda")
    for x in (-0.48, 0.48):
        p["Gris"].caja((0.04, 0.45, 2.0), (x, 0, 1.0))
    p["Gris"].caja((1.0, 0.02, 2.0), (0, 0.215, 1.0))
    colores = ["CajaRoja", "CajaAmarilla", "CajaAzul", "CajaBlanca", "Botella", "CajaVerde"]
    for k, z in enumerate((0.12, 0.5, 0.88, 1.26, 1.64)):
        p["Gris"].caja((0.92, 0.42, 0.025), (0, 0, z))
        x = -0.42
        i = k * 2
        while x < 0.4:
            ancho = 0.1 + (i % 3) * 0.03
            alto = 0.16 + ((i * 3) % 4) * 0.04
            mat = colores[(i + k) % len(colores)]
            if mat == "Botella":
                p[mat].cilindro(0.035, alto + 0.08, (x + 0.04, -0.05, z + 0.0125 + (alto + 0.08) / 2), 10)
                p[mat].cilindro(0.035, alto + 0.08, (x + 0.04, 0.08, z + 0.0125 + (alto + 0.08) / 2), 10)
                ancho = 0.09
            else:
                p[mat].caja((ancho - 0.01, 0.3, alto), (x + ancho / 2, 0.0, z + 0.0125 + alto / 2))
            x += ancho
            i += 1
    p.crear()
    colision("estanteria", (0, 0, 1.0), (1.0, 0.45, 2.0))
    exportar("estanteria_tienda")


def vitrina_panaderia():
    reiniciar()
    p = Piezas("vitrina_panaderia")
    p["MaderaClara"].caja((1.6, 0.7, 0.8), (0, 0, 0.4), bisel=0.01)
    p["Lacado"].caja((1.56, 0.6, 0.02), (0, -0.04, 0.82))
    p["Cristal"].caja((1.58, 0.02, 0.34), (0, -0.33, 0.98))
    p["Cristal"].caja((1.58, 0.56, 0.02), (0, -0.06, 1.15))
    for x in (-0.79, 0.79):
        p["Cristal"].caja((0.02, 0.56, 0.34), (x, -0.06, 0.98))
    for i in range(7):
        x = -0.62 + i * 0.2
        p["Pan" if i % 2 else "PanOscuro"].esfera(0.08, (x, -0.06 + (i % 3) * 0.06, 0.88), (1.5, 0.7, 0.55), 1, 0.06)
    p["Encimera"].caja((1.6, 0.12, 0.04), (0, 0.29, 1.0))
    p.crear()
    colision("vitrina", (0, 0, 0.57), (1.6, 0.7, 1.15))
    exportar("vitrina_panaderia")


def expositor_farmacia():
    reiniciar()
    p = Piezas("expositor_farmacia")
    for x in (-0.49, 0.49):
        p["Lacado"].caja((0.02, 0.4, 2.1), (x, 0, 1.05))
    p["Lacado"].caja((1.0, 0.02, 2.1), (0, 0.19, 1.05))
    p["RotuloVerde"].caja((0.96, 0.02, 0.12), (0, -0.19, 2.02))
    for k, z in enumerate((0.1, 0.45, 0.8, 1.15, 1.5)):
        p["Lacado"].caja((0.96, 0.38, 0.02), (0, 0, z))
        for i in range(7):
            mat = "CajaBlanca" if (i + k) % 3 else ("CajaVerde" if k % 2 else "CajaAzul")
            alto = 0.12 + ((i + k) % 3) * 0.04
            p[mat].caja((0.1, 0.18, alto), (-0.39 + i * 0.13, -0.06, z + 0.01 + alto / 2))
    p.crear()
    colision("expositor", (0, 0, 1.05), (1.0, 0.4, 2.1))
    exportar("expositor_farmacia")


def sillon_peluqueria():
    reiniciar()
    p = Piezas("sillon_peluqueria")
    # tocador con espejo contra la pared (detrás)
    p["Lacado"].caja((0.9, 0.34, 0.05), (0, 0.5, 0.85), bisel=0.01)
    p["Lacado"].caja((0.04, 0.3, 0.83), (-0.42, 0.5, 0.42))
    p["Lacado"].caja((0.04, 0.3, 0.83), (0.42, 0.5, 0.42))
    p["Espejo"].caja((0.72, 0.015, 0.9), (0, 0.665, 1.45))
    p["Negro"].caja((0.78, 0.02, 0.96), (0, 0.672, 1.45))
    p["Bombilla"].caja((0.6, 0.04, 0.04), (0, 0.64, 1.95))
    p["Negro"].cilindro(0.05, 0.12, (0.25, 0.48, 0.93), 12)
    p["Cromo"].cilindro(0.025, 0.2, (-0.25, 0.48, 0.97), 10)
    # sillón mirando al espejo
    cy = -0.2
    p["Cromo"].cilindro(0.26, 0.03, (0, cy, 0.015), 24)
    p["Cromo"].cilindro(0.05, 0.38, (0, cy, 0.22), 12)
    p["Cuero"].caja((0.56, 0.52, 0.12), (0, cy, 0.48), bisel=0.04)
    p["Cuero"].caja((0.52, 0.12, 0.6), (0, cy - 0.27, 0.82), (14, 0, 0), bisel=0.05)
    for x in (-0.31, 0.31):
        p["Cuero"].caja((0.08, 0.46, 0.08), (x, cy + 0.02, 0.66), bisel=0.02)
        p["Cromo"].caja((0.03, 0.03, 0.14), (x, cy + 0.15, 0.56))
    p["Cromo"].caja((0.4, 0.14, 0.02), (0, cy + 0.38, 0.2))
    p.crear()
    colision("silla", (0, cy, 0.5), (0.62, 0.66, 1.05))
    colision("tocador", (0, 0.5, 0.95), (0.9, 0.35, 1.9))
    vacio("SEAT_0", (0, cy, 0.56), giro_z=180, tipo="ARROWS")
    exportar("sillon_peluqueria")


# --------------------------------------------------------------------------- azotea


def deposito():
    reiniciar()
    p = Piezas("deposito")
    patas(p, "Hierro", 1.1, 1.1, 0.5, 0.06, 0.05)
    p["Hierro"].caja((1.2, 1.2, 0.05), (0, 0, 0.52))
    p["Deposito"].cilindro(0.6, 1.25, (0, 0, 1.17), 28)
    p["Deposito"].cilindro(0.62, 0.06, (0, 0, 1.82), 28, 0.4)
    p["Hierro"].segmento((0.5, -0.3, 0.7), (0.62, -0.62, 0.05), 0.03, 0.03, 8)
    p.crear()
    colision("deposito", (0, 0, 0.95), (1.3, 1.3, 1.9))
    exportar("deposito")


def antena():
    reiniciar()
    p = Piezas("antena")
    p["Hierro"].caja((0.3, 0.3, 0.04), (0, 0, 0.02))
    p["Cromo"].cilindro(0.025, 2.6, (0, 0, 1.32), 8)
    for z, largo in ((2.2, 0.9), (2.55, 0.7)):
        p["Cromo"].caja((largo, 0.02, 0.02), (0, 0, z))
        for i in range(6):
            p["Cromo"].caja((0.012, 0.3 - i * 0.03, 0.012), (-largo / 2 + 0.05 + i * (largo - 0.1) / 5, 0, z))
    p["Lacado"].esfera(0.28, (0.12, -0.18, 1.5), (1, 0.25, 1), 2)
    p["Hierro"].caja((0.04, 0.12, 0.04), (0.05, -0.1, 1.5))
    for a in (0, 120, 240):
        dx, dy = girar(0.7, 0, a)
        p["Negro"].segmento((0, 0, 2.0), (dx * 0.4, dy * 0.4, 0.04), 0.004, 0.004, 4)
    p.crear()
    colision("antena", (0, 0, 1.4), (0.3, 0.3, 2.8))
    exportar("antena")


def tendedero():
    reiniciar()
    p = Piezas("tendedero")
    for x in (-0.95, 0.95):
        p["Hierro"].caja((0.05, 0.05, 1.7), (x, 0, 0.85))
        p["Hierro"].caja((0.05, 1.3, 0.05), (x, 0, 1.68))
        p["Hierro"].caja((0.3, 0.3, 0.03), (x, 0, 0.015))
    for y in (-0.5, -0.17, 0.17, 0.5):
        p["Lacado"].caja((1.9, 0.008, 0.008), (0, y, 1.66))
    for i, (x, y, alto, mat) in enumerate(((-0.6, -0.5, 0.5, "Ropa1"), (-0.1, -0.5, 0.35, "Ropa2"), (0.45, -0.17, 0.6, "Ropa3"), (-0.4, 0.17, 0.4, "Ropa2"), (0.2, 0.5, 0.45, "Ropa1"))):
        p[mat].caja((0.38, 0.01, alto), (x, y, 1.66 - alto / 2), (0, 0, (i - 2) * 3))
    p.crear()
    colision("poste0", (-0.95, 0, 0.85), (0.12, 0.12, 1.7))
    colision("poste1", (0.95, 0, 0.85), (0.12, 0.12, 1.7))
    exportar("tendedero")


def maquina_aire():
    reiniciar()
    p = Piezas("maquina_aire")
    p["Lacado"].caja((0.8, 0.3, 0.55), (0, 0, 0.33), bisel=0.015)
    p["Gris"].segmento((0.1, -0.15, 0.33), (0.1, -0.16, 0.33), 0.2, 0.2, 24)
    p["Negro"].segmento((0.1, -0.16, 0.33), (0.1, -0.165, 0.33), 0.17, 0.17, 24)
    for x in (-0.3, 0.3):
        p["Gris"].caja((0.06, 0.34, 0.05), (x, 0, 0.025))
    p.crear()
    colision("maquina", (0, 0, 0.3), (0.8, 0.35, 0.6))
    exportar("maquina_aire")


# --------------------------------------------------------------------------- puertas, ventanas, escalera y ascensor


def puerta_interior():
    reiniciar()
    p = Piezas("puerta_interior")
    # hueco de 0,82 × 2,05 en un tabique de 10 cm: jambas, dintel y tapajuntas a los dos lados
    for x in (-0.445, 0.445):
        p["PuertaInterior"].caja((0.07, 0.14, 2.09), (x, 0, 1.045))
    p["PuertaInterior"].caja((0.96, 0.14, 0.07), (0, 0, 2.085))
    hoja(
        [
            ("PuertaInterior", [((0.8, 0.04, 2.02), (0, 0, 1.015))]),
            ("Cromo", [((0.12, 0.02, 0.02), (0.3, -0.04, 1.0)), ((0.12, 0.02, 0.02), (0.3, 0.04, 1.0)), ((0.03, 0.08, 0.03), (0.34, 0, 1.0))]),
        ],
        (-0.4, 0, 0),
    )
    p.crear()
    exportar("puerta_interior")


def puerta_piso():
    reiniciar()
    p = Piezas("puerta_piso")
    for x in (-0.5, 0.5):
        p["PuertaPiso"].caja((0.08, 0.2, 2.15), (x, 0, 1.075))
    p["PuertaPiso"].caja((1.08, 0.2, 0.08), (0, 0, 2.14))
    hoja(
        [
            ("PuertaPiso", [((0.88, 0.05, 2.08), (0, 0, 1.04))] + [((0.3, 0.02, 0.6), (x, -0.032, z)) for x in (-0.2, 0.2) for z in (0.55, 1.45)]),
            ("Cromo", [((0.03, 0.06, 0.03), (0.36, -0.04, 1.02)), ((0.1, 0.02, 0.02), (0.33, -0.065, 1.02)), ((0.03, 0.02, 0.03), (0, -0.03, 1.55))]),
            ("Placa", [((0.12, 0.012, 0.08), (0, -0.03, 1.75))]),
        ],
        (-0.44, 0, 0),
    )
    p.crear()
    exportar("puerta_piso")


def ventana():
    reiniciar()
    p = Piezas("ventana")
    # en la cara de dentro del muro (y = 0), con el muro hacia +Y; hueco de 1,2 × 1,4 (de 0,9 a 2,3 m)
    y = 0.12
    for x in (-0.57, 0.57):
        p["Pvc"].caja((0.06, 0.07, 1.4), (x, y, 1.6))
    for z in (0.93, 2.27):
        p["Pvc"].caja((1.2, 0.07, 0.06), (0, y, z))
    p["Pvc"].caja((0.05, 0.07, 1.28), (0, y, 1.6))
    for x in (-0.285, 0.285):
        p["Cristal"].caja((0.5, 0.01, 1.28), (x, y, 1.6))
        p["Cromo"].caja((0.02, 0.03, 0.12), (x + (0.2 if x < 0 else -0.2), y - 0.05, 1.55))
    p["Marmol"].caja((1.3, 0.2, 0.03), (0, 0.06, 0.885))  # alféizar
    p["Persiana"].caja((1.18, 0.015, 0.34), (0, 0.2, 2.13))  # persiana a medio bajar, por fuera
    p["Pvc"].caja((1.3, 0.12, 0.2), (0, 0.04, 2.42))  # caja de la persiana
    p["Pvc"].caja((0.02, 0.02, 0.8), (0.67, -0.02, 1.7))  # cinta
    p.crear()
    exportar("ventana")


def escalera():
    reiniciar()
    p = Piezas("escalera")
    huella, tabica, peldanos = 0.27, 0.15, 9
    recorrido = huella * peldanos
    xa, xb = -0.7, 0.7  # centro de cada tramo
    # primer tramo: sube desde la entrada (y = 0) hacia el fondo; segundo: vuelve desde la meseta a la planta de arriba
    for k in range(1, peldanos + 1):
        p["Peldano"].caja((1.2, huella + 0.02, tabica), (xa, (k - 0.5) * huella, k * tabica - tabica / 2), bisel=0.006)
        p["Peldano"].caja((1.2, huella + 0.02, tabica), (xb, recorrido - (k - 0.5) * huella, 1.5 + k * tabica - tabica / 2), bisel=0.006)
    # meseta y losas inclinadas bajo los tramos (lo que se ve por debajo)
    p["Peldano"].caja((2.6, 1.27, 0.2), (0, recorrido + 0.635, 1.4))
    largo = math.hypot(recorrido, 1.35)
    angulo = math.degrees(math.atan2(1.35, recorrido))
    p["Losa"].caja((1.2, largo, 0.14), (xa, recorrido / 2, 0.6), (angulo, 0, 0))
    p["Losa"].caja((1.2, largo, 0.14), (xb, recorrido / 2, 2.1), (-angulo, 0, 0))
    # barandillas en el ojo, con barrotes y pasamanos de madera
    for x, base, sube in ((-0.12, 0.0, 1), (0.12, 1.5, -1)):
        for k in range(1, peldanos + 1):
            yk = (k - 0.5) * huella if sube > 0 else recorrido - (k - 0.5) * huella
            zk = base + k * tabica
            p["Hierro"].caja((0.018, 0.018, 0.9), (x, yk, zk + 0.45))
        y0, z0 = (0.0, base + 0.15 + 0.9) if sube > 0 else (recorrido, base + 0.15 + 0.9)
        y1, z1 = (recorrido, base + 1.5 + 0.9) if sube > 0 else (0.0, base + 1.5 + 0.9)
        p["MaderaOscura"].segmento((x, y0, z0), (x, y1, z1), 0.03, 0.03, 8)
    p["Hierro"].caja((0.24, 0.03, 1.0), (0, recorrido + 0.02, 1.5 + 0.5))
    p.crear()
    exportar("escalera")


def ascensor():
    reiniciar()
    p = Piezas("ascensor")
    # cabina de 1,1 × 1,25 × 2,2: la entrada en y = 0, el fondo hacia +Y
    p["Negro"].caja((1.18, 1.29, 0.04), (0, 0.645, -0.02))
    for x in (-0.57, 0.57):
        p["Inox"].caja((0.04, 1.29, 2.2), (x, 0.645, 1.1))
    p["Inox"].caja((1.18, 0.04, 2.2), (0, 1.27, 1.1))
    p["Espejo"].caja((0.9, 0.01, 1.0), (0, 1.245, 1.35))
    p["Lacado"].caja((1.18, 1.29, 0.04), (0, 0.645, 2.22))
    p["Bombilla"].caja((0.6, 0.6, 0.01), (0, 0.645, 2.195))
    p["Cromo"].caja((0.9, 0.03, 0.03), (0, 1.2, 0.9))
    p["Negro"].caja((0.02, 0.16, 0.42), (0.545, 0.22, 1.2))
    for i in range(6):
        p["Bombilla"].cilindro(0.012, 0.008, (0.535, 0.17 + (i % 2) * 0.08, 1.05 + (i // 2) * 0.1), 8)
    p.crear()
    exportar("ascensor")


def ascensor_puerta():
    reiniciar()
    p = Piezas("ascensor_puerta")
    # puerta de planta en un muro de 15 cm (la cara del rellano en y = 0): hueco de 0,8 × 2,1
    for x in (-0.44, 0.44):
        p["Inox"].caja((0.08, 0.05, 2.15), (x, -0.02, 1.075))
    p["Inox"].caja((0.96, 0.05, 0.08), (0, -0.02, 2.14))
    p["Negro"].caja((0.3, 0.02, 0.1), (0, -0.04, 2.32))
    p["Bombilla"].caja((0.08, 0.025, 0.06), (0, -0.045, 2.32))
    p["Inox"].caja((0.08, 0.02, 0.16), (0.62, -0.01, 1.1))
    p["Bombilla"].cilindro(0.015, 0.01, (0.62, -0.02, 1.13), 10)
    p.crear()
    for nombre, x in (("PUERTA_CORREDERA_I", -0.2), ("PUERTA_CORREDERA_D", 0.2)):
        g = Grupo(nombre, M("Inox"))
        g.caja((0.4, 0.03, 2.08), (x, 0.03, 1.04), bisel=0.003)
        objeto = g.crear(origen=(x, 0.03, 0))
        objeto.name = nombre
    exportar("ascensor_puerta")


# --------------------------------------------------------------------------- fachada: portal, local y rótulos


def portal():
    reiniciar()
    p = Piezas("portal")
    # hueco de 1,3 × 2,6 en la fachada (y = 0) con el muro de 25 cm hacia +Y; abre hacia dentro
    for x in (-0.61, 0.61):
        p["Hierro"].caja((0.08, 0.25, 2.6), (x, 0.125, 1.3))
    p["Hierro"].caja((1.3, 0.25, 0.08), (0, 0.125, 2.56))
    p["Hierro"].caja((1.14, 0.1, 0.06), (0, 0.08, 2.2))
    p["Cristal"].caja((1.14, 0.02, 0.32), (0, 0.08, 2.38))
    for x in (-0.3, 0, 0.3):
        p["Hierro"].caja((0.02, 0.03, 0.32), (x, 0.08, 2.38))
    p["Marmol"].caja((1.36, 0.36, 0.05), (0, 0.1, 0.025))
    # por fuera: portero automático, número y aplique
    p["Aluminio"].caja((0.16, 0.03, 0.3), (0.92, -0.015, 1.35), bisel=0.005)
    for i in range(6):
        p["Negro"].cilindro(0.012, 0.01, (0.88 + (i % 2) * 0.08, -0.03, 1.27 + (i // 2) * 0.05), 8)
    p["Negro"].caja((0.1, 0.01, 0.05), (0.92, -0.032, 1.45))
    p["PlacaAzul"].caja((0.3, 0.02, 0.2), (0, -0.01, 2.85), bisel=0.01)
    p["Lacado"].caja((0.24, 0.022, 0.14), (0, -0.012, 2.85))
    p["Hierro"].caja((0.1, 0.12, 0.1), (-0.95, -0.06, 2.45))
    p["Bombilla"].esfera(0.08, (-0.95, -0.14, 2.42), (1, 1, 1.2), 2)
    p.crear()
    hoja(
        [
            ("Hierro", [((0.06, 0.05, 2.1), (-0.54, 0.08, 1.1)), ((0.06, 0.05, 2.1), (0.54, 0.08, 1.1)), ((1.14, 0.05, 0.06), (0, 0.08, 0.08)),
                        ((1.14, 0.05, 0.06), (0, 0.08, 2.12)), ((1.14, 0.05, 0.25), (0, 0.08, 0.3))]
             + [((0.018, 0.03, 1.7), (x, 0.08, 1.27)) for x in (-0.3, -0.15, 0.0, 0.15, 0.3)]),
            ("Cristal", [((1.04, 0.015, 1.7), (0, 0.08, 1.27))]),
            ("Placa", [((0.04, 0.08, 0.04), (0.44, 0.04, 1.05)), ((0.3, 0.02, 0.02), (0, 0.045, 1.05))]),
        ],
        (-0.57, 0.08, 0),
    )
    exportar("portal")


def fachada_local():
    reiniciar()
    p = Piezas("fachada_local")
    # hueco de 3,4 × 2,7: escaparate a la izquierda y puerta de cristal a la derecha (vistos desde la calle)
    for x in (-1.66, 1.66):
        p["Aluminio"].caja((0.08, 0.25, 2.7), (x, 0.125, 1.35))
    p["Aluminio"].caja((3.4, 0.25, 0.1), (0, 0.125, 2.65))
    p["Aluminio"].caja((0.08, 0.1, 2.6), (0.56, 0.06, 1.3))
    p["Aluminio"].caja((1.04, 0.1, 0.06), (1.1, 0.06, 2.17))
    p["Cristal"].caja((1.02, 0.02, 0.42), (1.1, 0.06, 2.4))
    p["Hierro"].caja((2.14, 0.1, 0.45), (-0.55, 0.06, 0.225))
    p["Aluminio"].caja((2.14, 0.12, 0.04), (-0.55, 0.06, 0.47))
    p["Cristal"].caja((2.12, 0.02, 2.1), (-0.55, 0.06, 1.55))
    p["Marmol"].caja((1.04, 0.3, 0.05), (1.1, 0.1, 0.025))
    p.crear()
    hoja(
        [
            ("Aluminio", [((0.05, 0.05, 2.12), (0.625, 0.06, 1.07)), ((0.05, 0.05, 2.12), (1.575, 0.06, 1.07)),
                          ((0.95, 0.05, 0.05), (1.1, 0.06, 0.04)), ((0.95, 0.05, 0.05), (1.1, 0.06, 2.1)), ((0.95, 0.05, 0.12), (1.1, 0.06, 0.12))]),
            ("Cristal", [((0.9, 0.015, 1.9), (1.1, 0.06, 1.11))]),
            ("Cromo", [((0.03, 0.03, 0.7), (1.45, 0.02, 1.05)), ((0.03, 0.03, 0.7), (1.45, 0.1, 1.05))]),
        ],
        (0.6, 0.06, 0),
    )
    exportar("fachada_local")


def rotulo(nombre, letrero, fondo):
    reiniciar()
    p = Piezas(nombre)
    p[fondo].caja((3.2, 0.08, 0.5), (0, -0.04, 3.1), bisel=0.01)
    p["Aluminio"].caja((3.24, 0.09, 0.03), (0, -0.04, 3.36))
    p["Aluminio"].caja((3.24, 0.09, 0.03), (0, -0.04, 2.84))
    if nombre == "rotulo_farmacia":
        # la cruz verde, perpendicular a la fachada, sobre su brazo
        p["Hierro"].caja((0.06, 0.5, 0.04), (1.95, -0.25, 3.15))
        p["RotuloVerde"].caja((0.08, 0.56, 0.18), (1.95, -0.62, 3.15))
        p["RotuloVerde"].caja((0.08, 0.18, 0.56), (1.95, -0.62, 3.15))
    p.crear()
    texto(letrero, 0.3, (0, -0.09, 3.1), "Letras", nombre + "_letras")
    exportar(nombre)


def rotulo_tienda():
    rotulo("rotulo_tienda", "ALIMENTACIÓN", "RotuloRojo")


def rotulo_farmacia():
    rotulo("rotulo_farmacia", "FARMACIA", "RotuloVerde")


def rotulo_panaderia():
    rotulo("rotulo_panaderia", "PANADERÍA", "RotuloOcre")


def rotulo_peluqueria():
    rotulo("rotulo_peluqueria", "PELUQUERÍA", "RotuloAzul")


MODELOS = {
    "sofa": sofa, "sillon": sillon, "mesa_baja": mesa_baja, "mueble_tv": mueble_tv, "estanteria": estanteria, "alfombra": alfombra,
    "lampara_pie": lampara_pie, "comedor": comedor, "silla": silla_suelta, "cocina_bajo": cocina_bajo, "cocina_fregadero": cocina_fregadero,
    "cocina_placa": cocina_placa, "frigorifico": frigorifico, "cocina_alto": cocina_alto, "campana": campana, "mesa_cocina": mesa_cocina,
    "cama_doble": cama_doble, "cama_individual": cama_individual, "mesita": mesita, "armario": armario, "comoda": comoda,
    "escritorio": escritorio, "inodoro": inodoro, "lavabo": lavabo, "ducha": ducha, "banera": banera, "radiador": radiador,
    "plafon": plafon, "planta": planta, "buzones": buzones, "felpudo": felpudo, "cuadro": cuadro, "mostrador": mostrador,
    "estanteria_tienda": estanteria_tienda, "vitrina_panaderia": vitrina_panaderia, "expositor_farmacia": expositor_farmacia,
    "sillon_peluqueria": sillon_peluqueria, "deposito": deposito, "antena": antena, "tendedero": tendedero, "maquina_aire": maquina_aire,
    "puerta_interior": puerta_interior, "puerta_piso": puerta_piso, "ventana": ventana, "escalera": escalera, "ascensor": ascensor,
    "ascensor_puerta": ascensor_puerta, "portal": portal, "fachada_local": fachada_local, "rotulo_tienda": rotulo_tienda,
    "rotulo_farmacia": rotulo_farmacia, "rotulo_panaderia": rotulo_panaderia, "rotulo_peluqueria": rotulo_peluqueria,
}

if __name__ == "__main__":
    argumentos = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    for nombre in argumentos or MODELOS:
        if nombre not in MODELOS:
            raise SystemExit(f"No conozco el modelo «{nombre}». Opciones: {', '.join(MODELOS)}")
        MODELOS[nombre]()
