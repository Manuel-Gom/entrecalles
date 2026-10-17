# Guía: crear tu primer personaje realista (paso 1 de la Fase 2)

Objetivo de esta primera prueba: sacar **un solo personaje vestido en un archivo `.glb`** y comprobar que se ve bien en el navegador. Con ese resultado validamos todo el proceso antes de crear la biblioteca completa de peinados, ropa y cuerpos.

No necesitas saber modelar. Todo es gratis.

> Nota de honestidad: los nombres exactos de menús y paneles de Blender y de MPFB2 cambian entre versiones. Esta guía te dice **qué** hacer y **qué ajustes importan**; para encontrar cada botón, apóyate en la documentación oficial de MPFB (enlaces al final).

## 1. Instalar las herramientas

1. **Blender 4.2 o superior** (gratis): https://www.blender.org/download/
2. **MPFB2** (el generador de humanos, gratuito y de código abierto), desde la página de extensiones de Blender: https://extensions.blender.org/add-ons/mpfb/
   - En Blender: *Edit → Preferences → Get Extensions*, busca "MPFB" e instálalo.
3. **Paquetes de recursos** de MPFB2 (ropa, pelo, ojos, etc.): se descargan desde el propio complemento, en su panel de ajustes/descargas ("Downloading assets" en la documentación). Descarga al menos ropa y pelo.

## 2. Ajustes que importan para la web

Antes de crear nada, en los ajustes de MPFB2 (biblioteca / "Library settings") elige el tipo de material **PBR sencillo** para **piel, ropa y ojos**. Con los materiales avanzados (los de render realista de Blender) el archivo `.glb` sale con texturas blancas o grises.

## 3. Crear el personaje

1. Crea un humano nuevo con MPFB2 (panel "New human" / "Nuevo humano" de la barra lateral).
2. Ajusta con los deslizadores: género, edad, complexión y rasgos de la cara. Haz algo que parezca una persona real corriente, no un modelo de pasarela.
3. Añade **piel, ojos, cejas y pestañas**, un **peinado** y **3-4 prendas** (camiseta o sudadera, pantalón, zapatillas).
4. Añade un **esqueleto ("rig")**. Elige el esqueleto más sencillo que ofrezca (por ejemplo "Default" o el "Game engine"); no uses Rigify para esto.

## 4. Preparar la copia para exportar

MPFB 2.0.14 y posteriores incluyen una herramienta de **"Export copy"** (en la documentación: *Exporting MPFB characters → Export copy*). Crea un clon del personaje con los ajustes aplicados, sin estropear el original. Úsala:

- activando "aplicar modificadores" y "hornear shape keys";
- eliminando los helpers (partes auxiliares que no deben verse).

## 5. Exportar a glTF

*File → Export → glTF 2.0 (.glb/.gltf)* y marca:
- Formato: **glTF Binary (.glb)**.
- **Apply Modifiers**: activado.
- **Materials / Images (texturas)**: activado.
- **Skinning (armature)**: activado.

Guarda como `prueba-personaje.glb` en la carpeta `public/models/` del proyecto (créala si no existe).

## 6. Qué hago yo cuando lo tengas

Con ese archivo construyo el visor 3D real (carga, luz de estudio, giro con el ratón) y lo comparo contigo. Entonces decidimos:
- **Calidad:** si el realismo es suficiente o hace falta más trabajo de texturas.
- **Tamaño:** objetivo de menos de 25 000 triángulos por cuerpo y menos de 1,5 MB por pieza para que cargue rápido incluso en móvil.
- **Personalización:** cómo permitir cambiar peinado y ropa, y si los deslizadores de cara/cuerpo se pueden hacer en tiempo real (esto es lo más difícil, porque la ropa tiene que adaptarse; si no sale bien, usaremos varios cuerpos ya preparados).

## Enlaces oficiales de MPFB
- Inicio: https://static.makehumancommunity.org/mpfb.html
- Documentación: https://static.makehumancommunity.org/mpfb/docs.html
- Notas de la versión 2.0.14 (herramienta "Export copy"): https://static.makehumancommunity.org/mpfb/releases/release_2014.html

## Licencias
El software es GPL; los modelos y recursos que genera MPFB2 son CC0 según la documentación oficial. Confirma la licencia de cada paquete de recursos que descargues antes de publicar el juego.
